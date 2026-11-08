import 'dotenv/config';
import { DataSource, DataSourceOptions } from 'typeorm';
import { User }               from '../shared/entities/user.entity';
import { Booking }            from '../shared/entities/booking.entity';
import { PaymentTransaction } from '../shared/entities/payment.entity';
import { Wallet }             from '../shared/entities/wallet.entity';
import { Order }              from '../shared/entities/order.entity';
import { AuditLog }           from '../shared/entities/audit-log.entity';
import { FinancialLedger }    from '../shared/entities/financial-ledger.entity';
import { Queue }              from '../shared/entities/queue.entity';
import { GroupBooking }       from '../shared/entities/group-booking.entity';
import { ApartmentListing }   from '../shared/entities/apartment-listing.entity';
import { CarListing }         from '../shared/entities/car-listing.entity';
import { TableListing }       from '../shared/entities/table-listing.entity';
import { MenuItem }           from '../shared/entities/menu-item.entity';
import { Event }              from '../shared/entities/event.entity';
import { DeviceToken }        from '../shared/entities/device-token.entity';
import { Venue }              from '../shared/entities/venue.entity';
import { Station }            from '../shared/entities/station.entity';
import { TicketType }         from '../shared/entities/ticket-type.entity';
import { InventoryItem }      from '../shared/entities/inventory-item.entity';
import { InventoryTransaction } from '../shared/entities/inventory-transaction.entity';
import { PlatformSettings }   from '../shared/entities/platform-settings.entity';
import { NotificationCampaign } from '../shared/entities/notification-campaign.entity';
import { CampaignTier }       from '../shared/entities/campaign-tier.entity';
import { Notification }       from '../shared/entities/notification.entity';
import { Business }           from '../shared/entities/business.entity'; // ← NEW (multi-tenancy)
import { StaffBusinessAssignment } from '../shared/entities/staff-business-assignment.entity'; // ← NEW (multi-tenancy)
import { BusinessDataShare }  from '../shared/entities/business-data-share.entity'; // ← NEW (multi-tenancy)
import { JetListing }          from '../shared/entities/jet-listing.entity';

// ─── Validate required env vars on startup ───────────────────────────────────
const requiredEnvVars = [
  'DATABASE_HOST',
  'DATABASE_USER',
  'DATABASE_PASSWORD',
  'DATABASE_NAME',
];

for (const key of requiredEnvVars) {
  if (!process.env[key]) {
    throw new Error(
      `Missing required environment variable: ${key}. ` +
      `Make sure your .env file is present and loaded.`,
    );
  }
}

// ─── Data Source Options ──────────────────────────────────────────────────────
export const dataSourceOptions: DataSourceOptions = {
  type:     'postgres',
  host:     process.env.DATABASE_HOST,
  port:     parseInt(process.env.DATABASE_PORT ?? '5432'),
  username: process.env.DATABASE_USER,
  password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME,

  entities: [
    User, Booking, PaymentTransaction, Wallet, Order,
    AuditLog, FinancialLedger, Queue, GroupBooking,
    ApartmentListing, CarListing,
    TableListing,
    MenuItem,
    Event,
    DeviceToken,
    Venue,
    Station,
    TicketType,
    InventoryItem,
    InventoryTransaction,
    PlatformSettings,
    NotificationCampaign,
    CampaignTier,
    Notification,
    Business, StaffBusinessAssignment, BusinessDataShare, // ← NEW (multi-tenancy)
    JetListing,
  ],

  migrations: [__dirname + '/migrations/*{.ts,.js}'],

  // ⚠️  NEVER set synchronize: true in production.
  // It can auto-drop columns and destroy data.
  // Always use migrations: npm run db:migrate
  synchronize: false,

  migrationsRun: false, // run manually via: npm run db:migrate

  logging: process.env.NODE_ENV === 'development',

  ssl: process.env.DATABASE_SSL === 'true'
    ? { rejectUnauthorized: false }
    : false,
};

export const AppDataSource = new DataSource(dataSourceOptions);