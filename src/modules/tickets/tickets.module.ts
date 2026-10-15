import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Booking } from '../../shared/entities/booking.entity';
import { PlatformSettings } from '../../shared/entities/platform-settings.entity';
import { TicketsService } from './tickets.service';
import { TicketsController } from './tickets.controller';
import { AuditModule } from '../audit/audit.module';
import { BookingsModule } from '../bookings/bookings.module'; // ← NEW: scanTicket delegates to BookingService.updateBookingStatus
import { BusinessContextService } from '../../shared/services/business-context.service'; // ← NEW: TenantScopeGuard (now on TicketsController) depends on it

@Module({
  imports: [TypeOrmModule.forFeature([Booking, PlatformSettings]), AuditModule, BookingsModule],
  providers: [TicketsService, BusinessContextService],
  controllers: [TicketsController],
  exports: [TicketsService],
})
export class TicketsModule {}