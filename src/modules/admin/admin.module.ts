import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User }    from '../../shared/entities/user.entity';
import { Booking } from '../../shared/entities/booking.entity';
import { TableListing } from '../../shared/entities/table-listing.entity';
import { Venue } from '../../shared/entities/venue.entity';
import { Business } from '../../shared/entities/business.entity'; // ← NEW (multi-tenancy)
import { StaffBusinessAssignment } from '../../shared/entities/staff-business-assignment.entity'; // ← NEW (multi-tenancy)
import { BusinessDataShare } from '../../shared/entities/business-data-share.entity'; // ← NEW (Phase 5)
import { BookingsModule }      from '../bookings/bookings.module';
import { OrdersModule }        from '../orders/orders.module';
import { PaymentsModule }      from '../payments/payments.module';
import { AnalyticsModule }     from '../analytics/analytics.module';
import { AuditModule }         from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { InventoryModule } from '../inventory/inventory.module';
import { AdminService }             from './admin.service';
import { AdminBookingsController }  from './admin-bookings.controller';
import { AdminOrdersController }    from './admin-orders.controller';
import { AdminStaffController }     from './admin-staff.controller';
import { AdminDataSharingController } from './admin-sharing.controller'; // ← NEW (Phase 5)
import { AdminBusinessesController }  from './admin-business.controller';
import { OwnershipResolverService } from '../../shared/services/ownership-resolver.service';
import { BusinessContextService } from '../../shared/services/business-context.service'; // ← NEW (multi-tenancy)

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Booking, TableListing, Venue, Business, StaffBusinessAssignment, BusinessDataShare]), // ← CHANGED (Phase 5)
    BookingsModule,
    OrdersModule,
    PaymentsModule,
    InventoryModule,
    AnalyticsModule,                           // ← NEW
    AuditModule,
    NotificationsModule,
  ],
  providers:   [AdminService, OwnershipResolverService, BusinessContextService], // ← CHANGED (multi-tenancy)
  controllers: [
    AdminBookingsController,
    AdminOrdersController,
    AdminStaffController,
    AdminDataSharingController, // ← NEW (Phase 5)
    AdminBusinessesController,
  ],
  exports: [AdminService, OwnershipResolverService],
})
export class AdminModule {}