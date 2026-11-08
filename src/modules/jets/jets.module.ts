import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Booking } from '../../shared/entities/booking.entity';
import { JetListing } from '../../shared/entities/jet-listing.entity';
import { PlatformSettings } from '../../shared/entities/platform-settings.entity';
import { JetsService } from './jets.service';
import { JetListingsService } from './jet-listings.service';
import { JetsController } from './jets.controller';
import { AuditModule } from '../audit/audit.module';
import { BusinessContextService } from '../../shared/services/business-context.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Booking, JetListing, PlatformSettings]),
    AuditModule,
  ],
  providers: [JetsService, JetListingsService, BusinessContextService],
  controllers: [JetsController],
  exports: [JetsService, JetListingsService],
})
export class JetsModule {}
