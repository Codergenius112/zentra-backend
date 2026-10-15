import {
  Controller, Post, Get, Body, Param,
  UseGuards, HttpCode, BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard }   from '../../common/guards/jwt-auth.guard';
import { RolesGuard }     from '../../common/guards/roles.guard';
import { TenantScopeGuard } from '../../common/guards/tenant-scope.guard'; // ← NEW (multi-tenancy — payments/wallet gap fix)
import { Roles }          from '../../common/decorators/roles.decorator';
import { CurrentUser }    from '../../common/decorators/current-user.decorator';
import { IpAddress }      from '../../common/decorators/ip-address.decorator';
import { BusinessIds }    from '../../common/decorators/business-context.decorator'; // ← NEW (multi-tenancy — payments/wallet gap fix)
import { PaymentService } from './payments.service';
import { PaystackService } from './paystack.service';
import { WalletService }  from './wallet.service';
import { UserRole }       from '../../shared/enums';
import { v4 as uuidv4 }  from 'uuid';

@ApiTags('Payments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantScopeGuard, RolesGuard) // ← CHANGED (multi-tenancy — payments/wallet gap fix)
@Controller('payments')
export class PaymentsController {
  constructor(
    private paymentService: PaymentService,
    private paystackService: PaystackService,
    private walletService: WalletService,
  ) {}

  // ─── 1. Initialize Paystack transaction ─────────────────────────────────
  // Mobile calls this first to get an access code, then opens Paystack sheet.
  @Post('paystack/initialize')
  @Roles(UserRole.CUSTOMER)
  @HttpCode(200)
  @ApiOperation({ summary: 'Initialize a Paystack transaction' })
  async initializePaystackTransaction(
    @Body() body: { bookingId?: string; amount: number; purpose: 'booking' | 'wallet_topup' },
    @CurrentUser() user: any,
  ) {
    if (!body.amount || body.amount <= 0) {
      throw new BadRequestException('Invalid amount');
    }

    // Build a unique reference that encodes purpose for webhook routing
    const reference =
      body.purpose === 'wallet_topup'
        ? `wallet-topup-${user.id}-${Date.now()}`
        : `booking-${body.bookingId}-${uuidv4()}`;

    const result = await this.paystackService.initializeTransaction(
      user.email,
      body.amount,
      reference,
      {
        userId:    user.id,
        bookingId: body.bookingId ?? null,
        purpose:   body.purpose,
      },
    );

    return { ...result, reference };
  }

  // ─── 2. Verify Paystack transaction ─────────────────────────────────────
  // Mobile calls this after payment completes to confirm server-side.
  // Then calls POST /payments or POST /wallet/fund based on purpose.
  @Post('paystack/verify')
  @Roles(UserRole.CUSTOMER)
  @HttpCode(200)
  @ApiOperation({ summary: 'Verify a Paystack transaction by reference' })
  async verifyPaystackTransaction(
    @Body() body: { reference: string },
    @CurrentUser() user: any,
    @IpAddress() ipAddress: string,
  ) {
    if (!body.reference) {
      throw new BadRequestException('Reference is required');
    }

    const result = await this.paystackService.verifyTransaction(body.reference);

    // If this was a wallet top-up and status is success, auto-credit wallet.
    // Goes through creditVerifiedTopUp rather than walletService.credit: this
    // branch used to credit on EVERY call with the same reference (one real
    // payment replayed into unlimited balance) and credited the caller even
    // when the payment had been made under someone else's email. The shared
    // method is idempotent per reference and checks the payer is the caller.
    if (
      result.status === 'success' &&
      body.reference.startsWith('wallet-topup-')
    ) {
      const wallet = await this.walletService.creditVerifiedTopUp(
        user.id,
        user.email,
        result,
        ipAddress,
      );

      return {
        verified:    true,
        status:      result.status,
        amountNaira: result.amountNaira,
        purpose:     'wallet_topup',
        balance:     Number(wallet.balance),
      };
    }

    return {
      verified:    result.status === 'success',
      status:      result.status,
      amountNaira: result.amountNaira,
      reference:   result.reference,
    };
  }

  // ─── 3. List banks ───────────────────────────────────────────────────────
  @Get('banks')
  @Roles(UserRole.CUSTOMER, UserRole.ADMIN)
  @ApiOperation({ summary: 'Get list of Nigerian banks for withdrawal setup' })
  async listBanks() {
    return this.paystackService.listBanks();
  }

  // ─── 4. Resolve bank account ─────────────────────────────────────────────
  @Post('banks/resolve')
  @Roles(UserRole.CUSTOMER)
  @HttpCode(200)
  @ApiOperation({ summary: 'Verify a bank account number before withdrawal' })
  async resolveAccount(
    @Body() body: { accountNumber: string; bankCode: string },
  ) {
    return this.paystackService.resolveAccountNumber(
      body.accountNumber,
      body.bankCode,
    );
  }

  // ─── 5. Process payment (wallet or paystack post-verify) ─────────────────
  @Post()
  @Roles(UserRole.CUSTOMER)
  @HttpCode(200)
  @ApiOperation({ summary: 'Process a booking payment (wallet or Paystack)' })
  async processPayment(
  @Body() body: {
    bookingId: string;
    amount: number;
    method: 'wallet' | 'paystack';
    paystackReference?: string;
  },
  @CurrentUser() user: any,
  @IpAddress() ipAddress: string,
) {
  return this.paymentService.processPayment(
    body.bookingId,
    user.id,
    body.amount,
    body.method,
    ipAddress,
    body.paystackReference,
  );
}

  // ─── 6. Refund payment (admin only) ──────────────────────────────────────
  @Post('refund')
  @Roles(UserRole.ADMIN)
  @HttpCode(200)
  @ApiOperation({ summary: 'Refund a payment (admin only, service charge non-refundable)' })
  async refundPayment(
    @Body() body: { paymentId: string },
    @CurrentUser() user: any,
    @IpAddress() ipAddress: string,
    @BusinessIds() businessIds?: string[], // ← NEW (multi-tenancy — payments/wallet gap fix)
  ) {
    return this.paymentService.refundPayment(body.paymentId, user.id, ipAddress, businessIds);
  }

  // ─── 7. Get transaction ───────────────────────────────────────────────────
  @Get('transaction/:id')
  @Roles(UserRole.CUSTOMER, UserRole.ADMIN)
  @ApiOperation({ summary: 'Get a payment transaction by ID' })
  async getTransaction(@Param('id') transactionId: string) {
    return { transactionId };
  }
}