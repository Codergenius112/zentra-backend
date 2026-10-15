import {
  Injectable,
  BadRequestException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';

// ─── Response shapes ──────────────────────────────────────────────────────────
export interface PaystackInitResponse {
  authorizationUrl: string;
  accessCode: string;
  reference: string;
}

export interface PaystackVerifyResponse {
  status: 'success' | 'failed' | 'abandoned' | 'ongoing' | 'pending';
  reference: string;
  amountNaira: number;
  currency: string;
  paidAt: string | null;
  customerEmail: string;
  channel: string;
  // Metadata echoed back is Paystack's copy of what transaction/initialize
  // sent — attacker-controlled only for their own charges, never someone
  // else's. WalletService uses it to tell wallet top-ups apart from booking
  // payments; see creditVerifiedTopUp.
  metadata: { userId?: string; bookingId?: string | null; purpose?: string } | null;
}

export interface PaystackBankListItem {
  name: string;
  code: string;
}

export interface PaystackResolveAccountResponse {
  accountName: string;
  accountNumber: string;
}

export interface PaystackTransferRecipientResponse {
  recipientCode: string;
}

export interface PaystackTransferResponse {
  transferCode: string;
  reference: string;
  status: string;
}

@Injectable()
export class PaystackService {
  private readonly logger = new Logger(PaystackService.name);
  private readonly client: AxiosInstance;
  // ← CHANGED (production resilience): no longer throws at construction
  // time. NestJS eagerly instantiates every provider at boot, so a
  // constructor-time throw here previously crashed the ENTIRE application
  // — every module, every unrelated endpoint — the moment
  // PAYSTACK_SECRET_KEY was missing, even for someone who only wants to
  // test bookings/venues/staff and has zero intention of touching
  // payments. The key is now checked lazily, only when a method that
  // actually calls Paystack's API is invoked — the app boots fine without
  // it, and using a Paystack method without it configured still fails
  // loudly and immediately, just deferred to the point of actual use.
  private readonly secretKey: string | null;

  constructor() {
    const secret = process.env.PAYSTACK_SECRET_KEY;
    this.secretKey = secret || null;

    if (!this.secretKey) {
      this.logger.warn(
        'PAYSTACK_SECRET_KEY is not set — payment features will fail if used, but the rest of the app will run normally.',
      );
    }

    this.client = axios.create({
      baseURL: 'https://api.paystack.co',
      headers: {
        Authorization: `Bearer ${this.secretKey ?? ''}`,
        'Content-Type': 'application/json',
      },
      timeout: 30_000,
    });
  }

  /** Called at the start of every method below that actually hits Paystack's API. */
  private ensureConfigured(): void {
    if (!this.secretKey) {
      throw new InternalServerErrorException(
        'PAYSTACK_SECRET_KEY is not set in environment variables.',
      );
    }
  }

  // ─── 1. Initialize a transaction (Paystack Popup / Redirect) ──────────────
  // Call this before showing the Paystack payment sheet on mobile.
  // Returns the authorization URL and a reference to track the payment.
  async initializeTransaction(
    email: string,
    amountNaira: number,
    reference: string,
    metadata?: Record<string, any>,
  ): Promise<PaystackInitResponse> {
    this.ensureConfigured();
    if (amountNaira <= 0) {
      throw new BadRequestException('Amount must be greater than 0');
    }

    try {
      const { data } = await this.client.post('/transaction/initialize', {
        email,
        amount: Math.round(amountNaira * 100), // Paystack works in kobo
        reference,
        currency: 'NGN',
        metadata: metadata ?? {},
      });

      if (!data.status) {
        throw new BadRequestException(data.message || 'Paystack initialization failed');
      }

      return {
        authorizationUrl: data.data.authorization_url,
        accessCode:       data.data.access_code,
        reference:        data.data.reference,
      };
    } catch (err: any) {
      this.logger.error('Paystack initializeTransaction failed', err?.response?.data ?? err.message);
      throw new BadRequestException(
        err?.response?.data?.message ?? 'Failed to initialize Paystack transaction',
      );
    }
  }

  // ─── 2. Verify a transaction ───────────────────────────────────────────────
  // Call this server-side after mobile confirms payment to double-check
  // with Paystack before crediting wallet or confirming booking.
  async verifyTransaction(reference: string): Promise<PaystackVerifyResponse> {
    this.ensureConfigured();
    if (!reference) {
      throw new BadRequestException('Reference is required');
    }

    try {
      const { data } = await this.client.get(
        `/transaction/verify/${encodeURIComponent(reference)}`,
      );

      if (!data.status) {
        throw new BadRequestException(data.message || 'Paystack verification failed');
      }

      const tx = data.data;

      return {
        status:        tx.status,
        reference:     tx.reference,
        amountNaira:   tx.amount / 100,
        currency:      tx.currency,
        paidAt:        tx.paid_at ?? null,
        customerEmail: tx.customer?.email ?? '',
        channel:       tx.channel ?? '',
        metadata:      tx.metadata ?? null,
      };
    } catch (err: any) {
      this.logger.error('Paystack verifyTransaction failed', err?.response?.data ?? err.message);
      throw new BadRequestException(
        err?.response?.data?.message ?? 'Failed to verify Paystack transaction',
      );
    }
  }

  // ─── 3. List banks (for withdrawal/payout setup) ──────────────────────────
  async listBanks(): Promise<PaystackBankListItem[]> {
    this.ensureConfigured();
    try {
      const { data } = await this.client.get('/bank?currency=NGN&perPage=100');

      return (data.data as any[]).map((b) => ({
        name: b.name,
        code: b.code,
      }));
    } catch (err: any) {
      this.logger.error('Paystack listBanks failed', err?.response?.data ?? err.message);
      throw new InternalServerErrorException('Failed to fetch bank list from Paystack');
    }
  }

  // ─── 4. Resolve bank account (verify account number before payout) ────────
  async resolveAccountNumber(
    accountNumber: string,
    bankCode: string,
  ): Promise<PaystackResolveAccountResponse> {
    this.ensureConfigured();
    try {
      const { data } = await this.client.get(
        `/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`,
      );

      if (!data.status) {
        throw new BadRequestException(data.message || 'Could not resolve account');
      }

      return {
        accountName:   data.data.account_name,
        accountNumber: data.data.account_number,
      };
    } catch (err: any) {
      this.logger.error('Paystack resolveAccountNumber failed', err?.response?.data ?? err.message);
      throw new BadRequestException(
        err?.response?.data?.message ?? 'Failed to resolve bank account',
      );
    }
  }

  // ─── 5. Create transfer recipient (required before payout) ────────────────
  async createTransferRecipient(
    name: string,
    accountNumber: string,
    bankCode: string,
  ): Promise<PaystackTransferRecipientResponse> {
    this.ensureConfigured();
    try {
      const { data } = await this.client.post('/transferrecipient', {
        type:           'nuban',
        name,
        account_number: accountNumber,
        bank_code:      bankCode,
        currency:       'NGN',
      });

      if (!data.status) {
        throw new BadRequestException(data.message || 'Could not create transfer recipient');
      }

      return {
        recipientCode: data.data.recipient_code,
      };
    } catch (err: any) {
      this.logger.error('Paystack createTransferRecipient failed', err?.response?.data ?? err.message);
      throw new BadRequestException(
        err?.response?.data?.message ?? 'Failed to create transfer recipient',
      );
    }
  }

  // ─── 6. Initiate transfer / payout ────────────────────────────────────────
  // Used when a user withdraws from their D-Lifestyle wallet to their bank.
  async initiateTransfer(
    amountNaira: number,
    recipientCode: string,
    reference: string,
    reason: string,
  ): Promise<PaystackTransferResponse> {
    this.ensureConfigured();
    if (amountNaira <= 0) {
      throw new BadRequestException('Transfer amount must be greater than 0');
    }

    try {
      const { data } = await this.client.post('/transfer', {
        source:    'balance',
        amount:    Math.round(amountNaira * 100), // kobo
        recipient: recipientCode,
        reference,
        reason,
      });

      if (!data.status) {
        throw new BadRequestException(data.message || 'Transfer initiation failed');
      }

      return {
        transferCode: data.data.transfer_code,
        reference:    data.data.reference,
        status:       data.data.status,
      };
    } catch (err: any) {
      this.logger.error('Paystack initiateTransfer failed', err?.response?.data ?? err.message);
      throw new BadRequestException(
        err?.response?.data?.message ?? 'Failed to initiate Paystack transfer',
      );
    }
  }
}