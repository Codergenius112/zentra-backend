import {
  Controller, Get, Post, Body, UseGuards, HttpCode,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { IsString, IsOptional, IsNumber } from 'class-validator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { IpAddress } from '../../common/decorators/ip-address.decorator';
import { WalletService } from './wallet.service';
import { UserRole } from '../../shared/enums';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FinancialLedger } from '../../shared/entities/financial-ledger.entity';

// Was previously `@Body() body: { amount: number; paystackReference: string
// }` — a plain TS type, not a class. class-validator (and this app's global
// ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })) has no
// metadata to work with for a plain type literal, so it silently did
// nothing: any JSON body passed straight through untouched. A real DTO
// class is what makes whitelisting actually happen.
class FundWalletDto {
  @IsString()
  paystackReference: string;

  // Accepted so the client can still send it for its own display/logging
  // purposes (and so existing mobile builds that send it don't get
  // rejected by forbidNonWhitelisted), but it is never trusted — see
  // WalletService.fundViaPaystack, which derives the real amount from
  // Paystack's own verify response, the same trust boundary
  // PaymentService.processPayment uses for booking payments.
  @IsOptional()
  @IsNumber()
  amount?: number;
}

@ApiTags('Wallet')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('wallet')
export class WalletController {
  constructor(
    private walletService: WalletService,
    @InjectRepository(FinancialLedger)
    private ledgerRepository: Repository<FinancialLedger>,
  ) {}

  /**
   * GET /wallet
   * Returns the authenticated user's wallet.
   * Auto-creates wallet if one doesn't exist yet.
   */
  @Get()
  @Roles(UserRole.CUSTOMER, UserRole.MANAGER, UserRole.ADMIN)
  async getWallet(@CurrentUser() user: any) {
    return this.walletService.getWallet(user.id);
  }

  /**
   * GET /wallet/transactions
   * Returns ledger entries (credits and debits) newest first.
   * WalletScreen maps these to the transaction history list.
   */
  @Get('transactions')
  @Roles(UserRole.CUSTOMER, UserRole.MANAGER, UserRole.ADMIN)
  async getTransactions(@CurrentUser() user: any) {
    const entries = await this.ledgerRepository.find({
      where: { relatedUserId: user.id },
      order: { timestamp: 'DESC' },
      take: 50,
    });

    const normalised = entries.map((e) => ({
      id:              e.id,
      transactionType: e.transactionType,
      amount:          Number(e.amount),
      description:     e.description,
      createdAt:       e.timestamp,
    }));

    return { entries: normalised, total: normalised.length };
  }

  /**
   * POST /wallet/fund
   * Called after a successful Paystack payment to credit the wallet.
   * Body: { paystackReference } — amount is accepted but never trusted,
   * see FundWalletDto and WalletService.fundViaPaystack.
   *
   * Previously this credited body.amount directly with ZERO verification —
   * no call to Paystack, no DTO (so the ValidationPipe couldn't even
   * whitelist the body), and mobile was sending a field literally named
   * `reference` while this read `paystackReference`, so the real-world
   * reference was always undefined anyway. Any authenticated customer could
   * call this directly with a fabricated amount and a made-up reference and
   * get free, repeatable wallet credit. Now delegates to
   * WalletService.fundViaPaystack, which independently re-verifies with
   * Paystack and rejects a reference already used for a previous top-up —
   * the same trust boundary PaymentService.processPayment uses for booking
   * payments.
   */
  @Post('fund')
  @Roles(UserRole.CUSTOMER)
  @HttpCode(200)
  async fundWallet(
    @Body() body: FundWalletDto,
    @CurrentUser() user: any,
    @IpAddress() ipAddress: string,
  ) {
    const wallet = await this.walletService.fundViaPaystack(
      user.id,
      user.email,
      body.paystackReference,
      ipAddress,
    );

    return {
      success: true,
      balance: Number(wallet.balance),
      message: 'Wallet funded successfully.',
    };
  }
}