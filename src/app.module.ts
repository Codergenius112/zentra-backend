import { Module } from '@nestjs/common';
import { ConfigModule }   from '@nestjs/config';
import { TypeOrmModule }  from '@nestjs/typeorm';
import { PassportModule } from '@nestjs/passport';
import { JwtModule }      from '@nestjs/jwt';
import { BullModule }     from '@nestjs/bull';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { StringValue }    from 'ms';
import { dataSourceOptions } from './database/data-source';

// ─── Feature Modules ──────────────────────────────────────────────────────────
import { AuditModule }         from './modules/audit/audit.module';
import { AnalyticsModule }     from './modules/analytics/analytics.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { AuthModule }          from './modules/auth/auth.module';
import { UsersModule }         from './modules/users/users.module';
import { ItineraryModule }     from './modules/itinerary/itinerary.module';
import { BookingsModule }      from './modules/bookings/bookings.module';
import { PaymentsModule }      from './modules/payments/payments.module';
import { OrdersModule }        from './modules/orders/orders.module';
import { QueuesModule }        from './modules/queues/queues.module';
import { TicketsModule }       from './modules/tickets/tickets.module';
import { TablesModule }        from './modules/tables/tables.module';
import { ApartmentsModule }    from './modules/apartments/apartments.module';
import { CarsModule }          from './modules/cars/cars.module';
import { JetsModule }          from './modules/jets/jets.module';
import { EventsModule }        from './modules/events/events.module';
import { VenueModule }         from './modules/venue/venue.module';
import { CampaignModule }      from './modules/campaign/campaign.module';
import { InventoryModule }     from './modules/inventory/inventory.module';
import { AdminModule }         from './modules/admin/admin.module';
import { SuperAdminModule }    from './modules/super-admin/super-admin.module';
import { UploadsModule }       from './modules/uploads/uploads.module';

// ─── Shared Services (no feature module owns these) ───────────────────────────
import { PricingService }    from './shared/services/pricing.service';
import { ValidationService } from './shared/services/validation.service';

// ─── Guards / Filters / Interceptors ──────────────────────────────────────────
import { JwtAuthGuard }        from './common/guards/jwt-auth.guard';
import { RolesGuard }          from './common/guards/roles.guard';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';

@Module({
  imports: [
    // ── Config ────────────────────────────────────────────────────────────────
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),

    // ── Rate Limiting ─────────────────────────────────────────────────────────
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),

    // ── Database ──────────────────────────────────────────────────────────────
    TypeOrmModule.forRoot(dataSourceOptions),

    // ── Auth ──────────────────────────────────────────────────────────────────
    PassportModule,
    JwtModule.register({
      secret:      process.env.JWT_SECRET || 'your-secret-key',
      signOptions: { expiresIn: (process.env.JWT_EXPIRATION || '3600s') as StringValue },
    }),

    // ── Queues ────────────────────────────────────────────────────────────────
    BullModule.forRoot({
      redis: process.env.REDIS_URL,
    }),

    // ── Scheduler ─────────────────────────────────────────────────────────────
    ScheduleModule.forRoot(),

    // ── Feature Modules (order: dependencies first) ───────────────────────────
    AuditModule,         // most modules depend on this
    AnalyticsModule,     // AdminModule + SuperAdminModule depend on this
    NotificationsModule, // BookingsModule + QueuesModule + AdminModule depend on this
    AuthModule,
    UsersModule,
    ItineraryModule,
    BookingsModule,      // includes LateArrivalService, GroupBookingCountdownService, BookingSchedulerService
    PaymentsModule,      // includes WalletController + PaystackService
    OrdersModule,
    QueuesModule,
    TicketsModule,
    TablesModule,
    ApartmentsModule,
    CarsModule,
    JetsModule,
    EventsModule,
    VenueModule,         // depends on AuditModule
    CampaignModule,      // depends on PaymentsModule + AuditModule + NotificationsModule
    InventoryModule,     // depends on AuditModule
    AdminModule,         // depends on Bookings, Orders, Payments, Analytics, Audit, Notifications
    SuperAdminModule,    // depends on Audit + Analytics + PlatformSettings
    UploadsModule,       // file upload support
  ],

  controllers: [], // every controller lives inside its feature module

  providers: [
    // Shared services — no feature module owns these
    PricingService,
    ValidationService,
    // Guards, filters, interceptors
    JwtAuthGuard,
    RolesGuard,
    ResponseInterceptor,
    HttpExceptionFilter,
  ],
})
export class AppModule {}