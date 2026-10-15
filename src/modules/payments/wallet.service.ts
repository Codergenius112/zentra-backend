import {
  Injectable,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager } from 'typeorm';
import { Wallet } from '../../shared/entities/wallet.entity';
import { User } from '../../shared/entities/user.entity';
import { FinancialLedger } from '../../shared/entities/financial-ledger.entity';
import { AuditService } from '../audit/audit.service';
import { AuditActionType } from '../../shared/enums';
import { PaystackService, PaystackVerifyResponse } from './paystack.service';

@Injectable()
export class WalletService {
  constructor(
    @InjectRepository(Wallet)
    private walletRepository: Repository<Wallet>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(FinancialLedger)
    private ledgerRepository: Repository<FinancialLedger>,
    private auditService: AuditService,
    private dataSource: DataSource,
    private paystackService: PaystackService,
  ) {}

  private readonly logger = new Logger(WalletService.name);

  // ─── WALLET TOP-UP — the one place a Paystack payment becomes wallet balance ──
  // Three entry points exist, and all of them must end up here:
  //   1. POST /wallet/fund               (fundViaPaystack)
  //   2. POST /payments/paystack/verify  (controller calls creditVerifiedTopUp)
  //   3. Paystack webhook                (fundFromWebhook)
  //
  // Before this, each credited on its own with different (mostly missing)
  // protections: /wallet/fund trusted the client's amount outright, and the
  // "server-verified" /payments/paystack/verify branch re-credited the wallet
  // on EVERY call with the same reference — and credited whoever called it,
  // even if the payment was made under a different email. One real ₦5,000
  // top-up could be replayed into unlimited balance, by anyone who knew the
  // reference.

  /** Client-triggered top-up: verify with Paystack, then credit. */
  async fundViaPaystack(
    userId: string,
    userEmail: string,
    paystackReference: string,
    ipAddress?: string,
  ): Promise<Wallet> {
    if (!paystackReference) {
      throw new BadRequestException('paystackReference is required');
    }
    const verification = await this.paystackService.verifyTransaction(paystackReference);
    return this.creditVerifiedTopUp(userId, userEmail, verification, ipAddress);
  }

  /**
   * Webhook-triggered top-up. Paystack's own verify response — not the
   * webhook payload — is the source of truth for both the amount and WHO
   * paid (customerEmail → our user). Returns null (rather than throwing)
   * when no account matches, since retrying can't fix that.
   */
  async fundFromWebhook(paystackReference: string, ipAddress?: string): Promise<Wallet | null> {
    const verification = await this.paystackService.verifyTransaction(paystackReference);
    if (verification.status !== 'success') {
      this.logger.warn(`Wallet top-up webhook: ${paystackReference} is not successful (${verification.status})`);
      return null;
    }

    const email = (verification.customerEmail ?? '').trim().toLowerCase();
    const user = email
      ? await this.userRepository
          .createQueryBuilder('u')
          .where('LOWER(u.email) = :email', { email })
          .getOne()
      : null;
    if (!user) {
      this.logger.warn(`Wallet top-up webhook: no account matches the payer of ${paystackReference}`);
      return null;
    }

    return this.creditVerifiedTopUp(user.id, user.email, verification, ipAddress);
  }

  /**
   * Credits an ALREADY-VERIFIED Paystack payment to a wallet — exactly once.
   *  - amount comes from Paystack's response, never from a caller
   *  - the payment must have been made under the claimant's own email
   *  - the balance change and its ledger row commit in ONE transaction,
   *    under the wallet row lock, so concurrent calls for the same
   *    reference serialize and the second becomes a no-op. (Previously the
   *    balance committed first and the ledger row was written separately —
   *    a crash between them left a credit with no replay marker.)
   */
  async creditVerifiedTopUp(
    userId: string,
    userEmail: string,
    verification: Pick<PaystackVerifyResponse, 'status' | 'reference' | 'amountNaira' | 'customerEmail' | 'metadata'>,
    ipAddress?: string,
  ): Promise<Wallet> {
    if (verification.status !== 'success') {
      throw new BadRequestException(
        `Paystack transaction ${verification.reference} was not successful (status: ${verification.status})`,
      );
    }

    // Purpose check: a verified, successful payment under this user's email
    // is not automatically a wallet top-up. Without this, one charge could
    // be double-spent — pay for a booking via /payments (CONFIRMED) and then
    // hand the SAME reference to /wallet/fund for the same amount (verified
    // the live stack). Only server-initialized top-ups
    // (`wallet-topup-…`, metadata.purpose='wallet_topup') and the app's own
    // inline-checkout top-ups (`ZTR-WALLET-…`, no metadata) may credit a
    // wallet; booking payments (`booking-…`) and anything else are rejected.
    const ref = verification.reference ?? '';
    const isTopUp =
      ref.startsWith('wallet-topup-') ||
      ref.startsWith('ZTR-WALLET-') ||
      verification.metadata?.purpose === 'wallet_topup';
    if (!isTopUp) {
      throw new BadRequestException('This payment was not a wallet top-up.');
    }

    const payer = (verification.customerEmail ?? '').trim().toLowerCase();
    const claimant = (userEmail ?? '').trim().toLowerCase();
    if (!payer || payer !== claimant) {
      // Deliberately vague: don't confirm to a stranger that this reference
      // is real, or whose it is.
      throw new BadRequestException('This payment does not belong to your account.');
    }

    const amount = Number(verification.amountNaira);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('Verified payment amount is invalid.');
    }

    const description = `Wallet top-up via Paystack (ref: ${verification.reference})`;
    let credited = false;

    const updated = await this.dataSource.transaction(async (manager) => {
      const wallet = await this.getWalletLocked(userId, manager);

      const alreadyCredited = await manager.findOne(FinancialLedger, { where: { description } });
      if (alreadyCredited) return wallet; // replay → safe no-op

      wallet.balance = Number(wallet.balance) + amount;
      wallet.lastTransactionAt = new Date();
      const saved = await manager.save(wallet);

      await manager.save(
        manager.create(FinancialLedger, {
          relatedUserId: userId,
          transactionType: 'CREDIT',
          amount,
          description,
        }),
      );

      credited = true;
      return saved;
    });

    if (credited) {
      // Money has already moved and committed. A failing audit write must not
      // turn that into a 500 — the client would retry (harmlessly now, but
      // still showing the user an error for a top-up that succeeded).
      try {
        await this.auditService.logAction({
          actionType: AuditActionType.WALLET_CREDITED,
          actorId: userId,
          resourceType: 'wallet',
          resourceId: updated.id,
          changes: { credit: amount, balance: updated.balance, reason: description },
          ipAddress,
        });
      } catch (err) {
        this.logger.error(`Audit log failed for wallet top-up ${verification.reference}`, err as any);
      }
    }

    return updated;
  }

  // ─── Internal helper: fetch wallet inside an existing transaction ──────────
  // Always uses pessimistic_write lock so concurrent requests queue up
  // rather than reading stale balances.
  private async getWalletLocked(
    userId: string,
    manager: EntityManager,
  ): Promise<Wallet> {
    const wallet = await manager.findOne(Wallet, {
      where: { userId },
      lock: { mode: 'pessimistic_write' },
    });

    if (!wallet) {
      throw new BadRequestException(`Wallet not found for user ${userId}`);
    }

    return wallet;
  }

  // ─── Public: read-only wallet fetch (no lock needed) ──────────────────────
  async getWallet(userId: string): Promise<Wallet> {
    let wallet = await this.walletRepository.findOne({ where: { userId } });

    if (!wallet) {
      // Auto-create wallet if it doesn't exist (e.g. legacy users)
      wallet = this.walletRepository.create({
        userId,
        balance: 0,
        currency: 'NGN',
      });
      wallet = await this.walletRepository.save(wallet);
    }

    return wallet;
  }

  async getBalance(userId: string): Promise<number> {
    const wallet = await this.getWallet(userId);
    return wallet.balance;
  }

  // ─── DEBIT ────────────────────────────────────────────────────────────────
  async debit(
    userId: string,
    amount: number,
    reason: string,
    ipAddress?: string,
  ): Promise<Wallet> {
    if (amount <= 0) {
      throw new BadRequestException('Amount must be greater than 0');
    }

    const updated = await this.dataSource.transaction(async (manager) => {
      const wallet = await this.getWalletLocked(userId, manager);

      if (wallet.balance < amount) {
        throw new BadRequestException(
          `Insufficient wallet balance. Available: ₦${wallet.balance}, Required: ₦${amount}`,
        );
      }

      wallet.balance = Number(wallet.balance) - amount;
      wallet.lastTransactionAt = new Date();

      return manager.save(wallet);
    });

    await this.auditService.logAction({
      actionType: AuditActionType.WALLET_DEBITED,
      actorId: userId,
      resourceType: 'wallet',
      resourceId: updated.id,
      changes: { debit: amount, balance: updated.balance, reason },
      ipAddress,
    });

    return updated;
  }

  // ─── CREDIT ───────────────────────────────────────────────────────────────
  async credit(
    userId: string,
    amount: number,
    reason: string,
    ipAddress?: string,
  ): Promise<Wallet> {
    if (amount <= 0) {
      throw new BadRequestException('Amount must be greater than 0');
    }

    const updated = await this.dataSource.transaction(async (manager) => {
      const wallet = await this.getWalletLocked(userId, manager);

      wallet.balance = Number(wallet.balance) + amount;
      wallet.lastTransactionAt = new Date();

      return manager.save(wallet);
    });

    await this.auditService.logAction({
      actionType: AuditActionType.WALLET_CREDITED,
      actorId: userId,
      resourceType: 'wallet',
      resourceId: updated.id,
      changes: { credit: amount, balance: updated.balance, reason },
      ipAddress,
    });

    return updated;
  }

  // ─── TRANSFER ─────────────────────────────────────────────────────────────
  // Locks BOTH wallets inside a single transaction.
  // Wallets are always locked in a consistent order (by userId, alphabetically)
  // to prevent deadlocks when two transfers happen in opposite directions
  // simultaneously (A→B and B→A).
  async transfer(
    fromUserId: string,
    toUserId: string,
    amount: number,
    reason: string,
    ipAddress?: string,
  ): Promise<void> {
    if (amount <= 0) {
      throw new BadRequestException('Amount must be greater than 0');
    }

    if (fromUserId === toUserId) {
      throw new BadRequestException('Cannot transfer to yourself');
    }

    // Deterministic lock order to prevent deadlocks
    const [firstId, secondId] =
      fromUserId < toUserId
        ? [fromUserId, toUserId]
        : [toUserId, fromUserId];

    let fromWalletId: string;

    await this.dataSource.transaction(async (manager) => {
      // Lock in consistent order
      const firstWallet  = await this.getWalletLocked(firstId, manager);
      const secondWallet = await this.getWalletLocked(secondId, manager);

      // Map back to sender/receiver regardless of lock order
      const fromWallet = firstId === fromUserId ? firstWallet : secondWallet;
      const toWallet   = firstId === fromUserId ? secondWallet : firstWallet;

      if (fromWallet.balance < amount) {
        throw new BadRequestException(
          `Insufficient balance for transfer. Available: ₦${fromWallet.balance}, Required: ₦${amount}`,
        );
      }

      fromWallet.balance = Number(fromWallet.balance) - amount;
      toWallet.balance   = Number(toWallet.balance)   + amount;

      fromWallet.lastTransactionAt = new Date();
      toWallet.lastTransactionAt   = new Date();

      await manager.save([fromWallet, toWallet]);

      fromWalletId = fromWallet.id;
    });

    await this.auditService.logAction({
      actionType: AuditActionType.WALLET_TRANSFERRED,
      actorId: fromUserId,
      resourceType: 'wallet',
      resourceId: fromWalletId!,
      changes: { transfer: amount, to: toUserId, reason },
      ipAddress,
    });
  }
}