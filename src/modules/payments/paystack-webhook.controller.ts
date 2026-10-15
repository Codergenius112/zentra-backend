import {
  Controller, Post, Headers, HttpCode,
  BadRequestException, Logger, Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { RawBodyRequest } from '@nestjs/common';
import * as crypto from 'crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PaymentTransaction } from '../../shared/entities/payment.entity';
import { Booking } from '../../shared/entities/booking.entity';
import { PaymentStatus } from '../../shared/enums';
import { PaymentService } from './payments.service';
import { WalletService } from './wallet.service';

@ApiTags('Payments - Webhook')
@Controller('payments')
export class PaystackWebhookController {
  private readonly logger = new Logger(PaystackWebhookController.name);

  constructor(
    @InjectRepository(PaymentTransaction)
    private paymentRepo: Repository<PaymentTransaction>,
    @InjectRepository(Booking)
    private bookingRepo: Repository<Booking>,
    private paymentService: PaymentService,
    private walletService: WalletService,
  ) {}

  @Post('webhook')
  @HttpCode(200)
  async handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-paystack-signature') signature: string,
  ) {
    // 1. Reject immediately if signature header is missing
    if (!signature) {
      this.logger.warn('Webhook rejected: missing signature header');
      throw new BadRequestException('Missing signature');
    }

    // 2. Ensure the raw buffer is actually present. req.rawBody is populated
    // by Nest itself (rawBody:true in main.ts's NestFactory.create) — NOT
    // req.body, which Nest's normal JSON parser still turns into a parsed
    // object for every route, this one included. There is deliberately no
    // separate express.raw() middleware for this route anymore; see the
    // comment in main.ts for why that broke every webhook call.
    if (!req.rawBody || !Buffer.isBuffer(req.rawBody)) {
      this.logger.error('Webhook rejected: req.rawBody missing — is rawBody:true still set in main.ts?');
      throw new BadRequestException('Invalid body format');
    }

    // 3. Verify HMAC-SHA512 signature
    const secret = process.env.PAYSTACK_SECRET_KEY;
    if (!secret) {
      this.logger.error('PAYSTACK_SECRET_KEY is not set in environment');
      throw new BadRequestException('Webhook misconfigured');
    }

    const rawBody = req.rawBody.toString('utf8');
    const hash = crypto
      .createHmac('sha512', secret)
      .update(rawBody)
      .digest('hex');

    const hashBuffer      = Buffer.from(hash, 'utf8');
    const signatureBuffer = Buffer.from(signature, 'utf8');

    const signaturesMatch =
      hashBuffer.length === signatureBuffer.length &&
      crypto.timingSafeEqual(hashBuffer, signatureBuffer);

    if (!signaturesMatch) {
      this.logger.warn('Webhook rejected: signature mismatch');
      throw new BadRequestException('Invalid signature');
    }

    // 4. Parse body only after signature is verified
    let payload: any;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      this.logger.error('Webhook rejected: invalid JSON body');
      throw new BadRequestException('Malformed payload');
    }

    const event = payload?.event;
    const data  = payload?.data;

    if (!event || !data) {
      this.logger.warn('Webhook rejected: missing event or data fields');
      throw new BadRequestException('Invalid payload structure');
    }

    this.logger.log(`Paystack webhook received: ${event}`);

    // 5. Route to handler
    switch (event) {
      case 'charge.success':
        await this.handleChargeSuccess(data);
        break;

      case 'transfer.success':
        await this.handleTransferSuccess(data);
        break;

      default:
        this.logger.log(`Unhandled webhook event ignored: ${event}`);
    }

    return { received: true };
  }

  private async handleChargeSuccess(data: any): Promise<void> {
    const reference = data?.reference;

    if (!reference || typeof reference !== 'string') {
      this.logger.warn('charge.success: missing or invalid reference');
      return;
    }

    // Wallet top-ups. An incoming card payment — which is what a top-up is —
    // arrives as `charge.success`. Previously the only wallet handling here
    // was under `transfer.success` (see handleTransferSuccess), so if the app
    // was killed between paying and calling /wallet/fund, the webhook found no
    // payment row, logged a warning and dropped it: money taken, wallet never
    // credited. Same shared, verified, idempotent path as the client routes.
    if (this.isWalletTopUp(reference, data)) {
      const wallet = await this.walletService.fundFromWebhook(reference, 'webhook');
      if (wallet) {
        this.logger.log(`Wallet top-up confirmed via webhook (ref: ${reference})`);
      }
      return;
    }

    const payment = await this.paymentRepo.findOne({
      where: { externalRefId: reference },
    });

    if (payment?.status === PaymentStatus.FULLY_PAID) {
      this.logger.log(`charge.success: payment ${reference} already confirmed — skipping`);
      return;
    }

    // bookingId: prefer an existing payment row's bookingId (set by
    // whichever path got there first — most often the client's own
    // post-verify call). Falls back to the bookingId Paystack echoes back
    // in the charge's metadata (set client-side when checkout was opened —
    // see PaymentScreen.startCharge's popup.checkout({ metadata }) call)
    // for the case where this webhook is the first thing to arrive at all.
    const bookingId = payment?.bookingId ?? data?.metadata?.bookingId;
    if (!bookingId || typeof bookingId !== 'string') {
      this.logger.warn(`charge.success: no payment record and no metadata.bookingId for ref: ${reference}`);
      return;
    }

    const booking = await this.bookingRepo.findOne({ where: { id: bookingId } });
    if (!booking) {
      this.logger.warn(`charge.success: bookingId ${bookingId} matches no booking (ref: ${reference})`);
      return;
    }

    // Always delegates to processPayment rather than hand-updating
    // payment/booking status here — this used to trust the webhook
    // payload's amount directly when a payment row already existed, only
    // logging a warning on mismatch and confirming anyway. processPayment
    // does its own independent, authoritative verifyTransaction call
    // against Paystack every time it runs (see payments.service.ts), so
    // this is the one place in the whole app that ever decides "this is
    // paid" — a mismatched or fabricated amount in the webhook payload
    // itself can no longer get silently accepted. It's also idempotent
    // (locks the booking row, no-ops if already fully paid), so this stays
    // safe regardless of whether the client's own call wins the race.
    await this.paymentService.processPayment(
      bookingId,
      booking.userId,
      0, // ignored for method:'paystack' — processPayment re-derives the real amount from Paystack directly
      'paystack',
      'webhook',
      reference,
    );
    this.logger.log(`Booking ${bookingId} confirmed via webhook (ref: ${reference})`);
  }

  // References a wallet top-up can carry: `wallet-topup-…` (built by
  // /payments/paystack/initialize), `ZTR-WALLET-…` (built by WalletScreen's
  // inline checkout), or an explicit metadata purpose. Booking references are
  // `booking-…` / `ZTR-<hex>-…`, so these can't collide with them.
  private isWalletTopUp(reference: string, data: any): boolean {
    return (
      reference.startsWith('wallet-topup-') ||
      reference.startsWith('ZTR-WALLET-') ||
      data?.metadata?.purpose === 'wallet_topup'
    );
  }

  // `transfer.success` is Paystack's event for a PAYOUT from our balance to a
  // bank account — not for money a customer paid in. This handler used to
  // credit a user's wallet straight from the payload's amount, parsing the
  // user id out of the reference string, with no check against Paystack
  // itself. It is not a legitimate source of wallet credit, so it no longer
  // credits from the payload: a `wallet-topup-` reference still goes through
  // the same verified, idempotent path as every other top-up (and fails
  // verification, harmlessly, if it is really a payout reference). Always
  // returns normally so Paystack doesn't retry an event we've decided
  // not to act on.
  private async handleTransferSuccess(data: any): Promise<void> {
    const reference = data?.reference;

    if (!reference || typeof reference !== 'string') {
      this.logger.warn('transfer.success: missing or invalid reference');
      return;
    }

    if (!reference.startsWith('wallet-topup-')) {
      this.logger.log(`transfer.success: ignoring non-wallet-topup reference: ${reference}`);
      return;
    }

    try {
      await this.walletService.fundFromWebhook(reference, 'webhook');
    } catch (err: any) {
      this.logger.warn(`transfer.success: ${reference} did not verify as a customer payment — not crediting (${err?.message ?? err})`);
    }
  }
}