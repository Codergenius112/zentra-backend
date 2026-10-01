import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Repository,
  DataSource,
  EntityManager,
} from 'typeorm';

import { Booking }            from '../../shared/entities/booking.entity';
import { PaymentTransaction } from '../../shared/entities/payment.entity';
import { Wallet }             from '../../shared/entities/wallet.entity';
import { FinancialLedger }    from '../../shared/entities/financial-ledger.entity';
import { User }               from '../../shared/entities/user.entity';

import {
  PaymentStatus,
  BookingStatus,
  AuditActionType,
  UserRole,
  BookingType,
} from '../../shared/enums';

import { AuditService } from '../audit/audit.service';
import { BusinessContextService } from '../../shared/services/business-context.service'; // ← NEW (multi-tenancy — payments/wallet gap fix)
import { EmailService } from '../../shared/services/email.service';

@Injectable()
export class PaymentService {
  // ₦400 service charge is non-refundable per business rules (section 8)
  private readonly SERVICE_CHARGE = parseFloat(
    process.env.SERVICE_CHARGE ?? '400',
  );

  constructor(
    @InjectRepository(Booking)
    private bookingRepository: Repository<Booking>,

    @InjectRepository(PaymentTransaction)
    private paymentRepository: Repository<PaymentTransaction>,

    @InjectRepository(Wallet)
    private walletRepository: Repository<Wallet>,

    @InjectRepository(FinancialLedger)
    private ledgerRepository: Repository<FinancialLedger>,

    @InjectRepository(User)
    private userRepository: Repository<User>,

    private dataSource: DataSource,
    private auditService: AuditService,
    private readonly businessContext: BusinessContextService, // ← NEW (multi-tenancy)
    private readonly emailService: EmailService,
  ) {}

  private async getTotalPaidForBookingTx(
    bookingId: string,
    manager: EntityManager,
  ): Promise<number> {
    const result = (await manager
      .createQueryBuilder(PaymentTransaction, 'payment')
      .select('COALESCE(SUM(payment.amount), 0)', 'total')
      .where('payment.bookingId = :bookingId', { bookingId })
      .andWhere('payment.status IN (:...statuses)', {
        statuses: [
          PaymentStatus.FULLY_PAID,
          PaymentStatus.PARTIALLY_PAID,
        ],
      })
      .getRawOne()) as { total: string };

    return Number(result.total);
  }

  async processPayment(
    bookingId: string,
    userId: string,
    amount: number,
    method: 'wallet' | 'paystack',
    ipAddress: string,
    paystackReference?: string,
  ): Promise<PaymentTransaction> {
    let savedPayment!: PaymentTransaction;

    await this.dataSource.transaction(async (manager: EntityManager) => {
      const booking = await manager.findOne(Booking, {
        where: { id: bookingId },
      });

      if (!booking) {
        throw new BadRequestException(`Booking ${bookingId} not found`);
      }

      if (amount <= 0) {
        throw new BadRequestException('Amount must be greater than 0');
      }

      if (method === 'wallet') {
        const wallet = await manager.findOne(Wallet, {
          where: { userId },
          lock: { mode: 'pessimistic_write' },
        });

        if (!wallet || wallet.balance < amount) {
          throw new BadRequestException('Insufficient wallet balance');
        }

        wallet.balance = Number(wallet.balance) - amount;
        wallet.lastTransactionAt = new Date();
        await manager.save(wallet);
      }

      const payment = manager.create(PaymentTransaction, {
        bookingId,
        userId,
        amount,
        paymentMethod: method,
        status: PaymentStatus.PARTIALLY_PAID,
        completedAt: new Date(),
        businessId: (booking as any).businessId ?? null, // ← NEW (multi-tenancy — payments/wallet gap fix)
        ...(paystackReference ? { externalRefId: paystackReference } : {}),
      });

      savedPayment = await manager.save(payment);

      const alreadyPaid = await this.getTotalPaidForBookingTx(bookingId, manager);
      const currentPaid = alreadyPaid + amount;

      if (currentPaid >= booking.totalAmount) {
        booking.paymentStatus = PaymentStatus.FULLY_PAID;
        booking.status       = BookingStatus.CONFIRMED;
        payment.status       = PaymentStatus.FULLY_PAID;
      } else {
        booking.paymentStatus = PaymentStatus.PARTIALLY_PAID;
      }

      booking.paymentMethod = method;

      await manager.save(booking);
      await manager.save(payment);

      const ledgerEntry = manager.create(FinancialLedger, {
        bookingId,
        transactionType: 'DEBIT',
        amount,
        description: `Payment for booking ${bookingId} via ${method}`,
        relatedUserId: userId,
      });

      await manager.save(ledgerEntry);
    });

    await this.auditService.logAction({
      actionType:   AuditActionType.PAYMENT_PROCESSED,
      actorId:      userId,
      resourceType: 'booking',
      resourceId:   bookingId,
      changes: {
        amountPaid: amount,
        method,
        status: savedPayment.status,
      },
      ipAddress,
    });

    const booking = await this.bookingRepository.findOne({ where: { id: bookingId } });
    if (booking && booking.paymentStatus === PaymentStatus.FULLY_PAID) {
      const customer = await this.userRepository.findOne({ where: { id: userId } });

      if (customer?.email) {
        const receiptSent = await this.emailService.sendReceiptEmail({
          to: customer.email,
          customerName: [customer.firstName, customer.lastName].filter(Boolean).join(' ') || customer.email,
          bookingId: booking.id,
          amount: Number(booking.totalAmount),
          currency: 'NGN',
          reference: savedPayment.externalRefId ?? booking.id,
          status: String(savedPayment.status),
          createdAt: new Date(),
        });

        if (receiptSent && booking.bookingType === BookingType.TICKET) {
          const qrPayload = {
            bookingId: booking.id,
            eventId: booking.resourceId,
            userId: booking.userId,
            guestCount: booking.guestCount ?? 1,
            issuedAt: new Date().toISOString(),
          };
          const qrDataUrl = await this.emailService.generateTicketQrDataUrl(qrPayload);
          booking.qrCodeData = JSON.stringify(qrPayload);
          await this.bookingRepository.save(booking);

          await this.emailService.sendTicketQrEmail({
            to: customer.email,
            customerName: [customer.firstName, customer.lastName].filter(Boolean).join(' ') || customer.email,
            bookingId: booking.id,
            eventId: booking.resourceId,
            guestCount: booking.guestCount ?? 1,
            qrCodeDataUrl: qrDataUrl,
          });
        }
      }
    }

    return savedPayment;
  }

  // ─── REFUND ───────────────────────────────────────────────────────────────
  // Business Rule (section 8): The ₦400 service charge is NON-REFUNDABLE.
  // Only the base price portion is returned to the user's wallet.
  async refundPayment(
    paymentId: string,
    actorId: string,
    ipAddress?: string,
    businessIds?: string[], // ← NEW (multi-tenancy — payments/wallet gap fix)
  ): Promise<PaymentTransaction> {
    return this.dataSource.transaction(async (manager: EntityManager) => {
      const payment = await manager.findOne(PaymentTransaction, {
        where: { id: paymentId },
      });

      if (!payment) {
        throw new NotFoundException('Payment not found');
      }

      // ← NEW (multi-tenancy — payments/wallet gap fix) — previously ANY
      // admin, from ANY business, could refund ANY payment on the entire
      // platform: nothing checked that the payment's booking actually
      // belonged to the admin's own business. businessId lives on the
      // Booking (payments themselves also carry a denormalized
      // businessId, checked here directly rather than re-fetching the
      // booking).
      if (businessIds !== undefined) {
        const paymentBusinessId = (payment as any).businessId;
        if (!businessIds.length || !paymentBusinessId || !businessIds.includes(paymentBusinessId)) {
          throw new NotFoundException('Payment not found');
        }
        await this.businessContext.assertBusinessActive(paymentBusinessId);
      }

      if (payment.status === PaymentStatus.REFUNDED) {
        throw new BadRequestException('Payment already refunded');
      }

      const refundableStatuses = [
        PaymentStatus.FULLY_PAID,
        PaymentStatus.PARTIALLY_PAID,
      ];

      if (!refundableStatuses.includes(payment.status)) {
        throw new BadRequestException('This payment cannot be refunded');
      }

      // ── Fetch the booking to read the service charge stored at booking time ──
      const booking = await manager.findOne(Booking, {
        where: { id: payment.bookingId },
      });

      // Non-refundable service charge (₦400 by default, or whatever was set)
      const nonRefundable = booking?.serviceCharge
        ? Number(booking.serviceCharge)
        : this.SERVICE_CHARGE;

      // Refundable amount = amount paid MINUS service charge (floor at 0)
      const refundableAmount = Math.max(
        Number(payment.amount) - nonRefundable,
        0,
      );

      if (refundableAmount === 0) {
        throw new BadRequestException(
          `Nothing to refund — the entire payment of ₦${payment.amount} ` +
          `is covered by the non-refundable service charge (₦${nonRefundable}).`,
        );
      }

      // Lock wallet and credit refundable amount only
      const wallet = await manager.findOne(Wallet, {
        where: { userId: payment.userId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!wallet) {
        throw new BadRequestException('Wallet not found');
      }

      wallet.balance = Number(wallet.balance) + refundableAmount;
      wallet.lastTransactionAt = new Date();
      await manager.save(wallet);

      // Ledger entry for the refunded amount
      const ledger = manager.create(FinancialLedger, {
        bookingId:       payment.bookingId,
        transactionType: 'CREDIT',
        amount:          refundableAmount,
        description:
          `Refund for payment ${payment.id}. ` +
          `₦${nonRefundable} service charge retained (non-refundable).`,
        relatedUserId: payment.userId,
      });
      await manager.save(ledger);

      // Mark payment refunded
      payment.status = PaymentStatus.REFUNDED;
      const updatedPayment = await manager.save(payment);

      // Recalculate booking payment state
      if (booking) {
        const totalPaid = await this.getTotalPaidForBookingTx(booking.id, manager);

        if (totalPaid <= 0) {
          booking.paymentStatus = PaymentStatus.UNPAID;
          booking.status        = BookingStatus.PENDING_PAYMENT;
        } else if (totalPaid < booking.totalAmount) {
          booking.paymentStatus = PaymentStatus.PARTIALLY_PAID;
          booking.status        = BookingStatus.PENDING_PAYMENT;
        } else {
          booking.paymentStatus = PaymentStatus.FULLY_PAID;
          booking.status        = BookingStatus.CONFIRMED;
        }

        await manager.save(booking);
      }

      await this.auditService.logAction({
        actionType:   AuditActionType.PAYMENT_REFUNDED,
        actorId,
        actorRole:    UserRole.ADMIN,
        resourceType: 'payment',
        resourceId:   payment.id,
        changes: {
          refundedAmount:      refundableAmount,
          serviceChargeKept:   nonRefundable,
          originalAmount:      payment.amount,
          status:              PaymentStatus.REFUNDED,
        },
        ipAddress,
      });

      return updatedPayment;
    });
  }
}