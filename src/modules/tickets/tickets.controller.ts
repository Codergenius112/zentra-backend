import { Controller, Post, Get, Patch, Body, Param, Query, UseGuards, HttpCode } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantScopeGuard } from '../../common/guards/tenant-scope.guard';
import { BusinessIds } from '../../common/decorators/business-context.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { IpAddress } from '../../common/decorators/ip-address.decorator';
import { TicketsService } from './tickets.service';
import { UserRole } from '../../shared/enums';

// A real DTO class (not `any`) so the global ValidationPipe actually
// validates and whitelists this body.
class ScanTicketDto {
  @IsString()
  @IsNotEmpty()
  qrCodeData: string;
}

@ApiTags('Tickets')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantScopeGuard, RolesGuard)
@Controller('tickets')
export class TicketsController {
  constructor(private ticketsService: TicketsService) {}

  @Post()
  @Roles(UserRole.CUSTOMER)
  @HttpCode(201)
  async createTicket(
    @Body() createTicketDto: any,
    @CurrentUser() user: any,
    @IpAddress() ipAddress: string,
  ) {
    return this.ticketsService.createTicket(user.id, createTicketDto, ipAddress);
  }

  // Door-staff / admin check-in from a scanned or pasted QR payload. Called
  // by the admin dashboard's Tickets page (apiClient.tickets.scan) — this
  // route did not exist before, so every manual check-in there 404'd.
  // Body: { qrCodeData } — either the emailed QR's JSON payload or a bare
  // bookingId. Tenant-scoped: staff can only check in their own business's
  // tickets (see TicketsService.scanTicket).
  @Post('scan')
  @Roles(UserRole.DOOR_STAFF, UserRole.MANAGER, UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @HttpCode(200)
  async scanTicket(
    @Body() dto: ScanTicketDto,
    @CurrentUser() user: any,
    @IpAddress() ipAddress: string,
    @BusinessIds() businessIds?: string[],
  ) {
    return this.ticketsService.scanTicket(dto.qrCodeData, user.id, user.role, ipAddress, businessIds);
  }

  @Get()
  @Roles(UserRole.CUSTOMER)
  async getMyTickets(
    @CurrentUser() user: any,
    @Query() query: any,
  ) {
    const [tickets, total] = await this.ticketsService.getUserTickets(
      user.id,
      query.limit || 20,
      query.offset || 0,
    );
    return { tickets, total };
  }

  @Get(':id')
  @Roles(UserRole.CUSTOMER)
  async getTicket(@Param('id') ticketId: string, @CurrentUser() user: any) {
    return this.ticketsService.getTicket(ticketId, user.id);
  }

  @Patch(':id/cancel')
  @Roles(UserRole.CUSTOMER)
  @HttpCode(200)
  async cancelTicket(
    @Param('id') ticketId: string,
    @CurrentUser() user: any,
    @IpAddress() ipAddress: string,
  ) {
    return this.ticketsService.cancelTicket(ticketId, user.id, ipAddress);
  }
}