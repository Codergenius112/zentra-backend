export enum BookingStatus {
  INITIATED = 'INITIATED',
  PENDING_PAYMENT = 'PENDING_PAYMENT',
  PENDING_GROUP_PAYMENT = 'PENDING_GROUP_PAYMENT',
  CONFIRMED = 'CONFIRMED',
  CHECKED_IN = 'CHECKED_IN',
  ACTIVE = 'ACTIVE',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
  EXPIRED = 'EXPIRED',
}

export enum BookingType {
  TICKET = 'ticket',
  TABLE = 'table',
  APARTMENT = 'apartment',
  CAR = 'car',
}

export enum PaymentStatus {
  UNPAID = 'UNPAID',
  PARTIALLY_PAID = 'PARTIALLY_PAID',
  FULLY_PAID = 'FULLY_PAID',
  REFUNDED = 'REFUNDED',
}

export enum TableCategory {
  STANDARD = 'standard',
  VIP = 'vip',
  VVIP = 'vvip',
  BOOTH = 'booth',
  PRIVATE = 'private',
}

export enum OrderStatus {
  CREATED = 'CREATED',
  ASSIGNED = 'ASSIGNED',
  ROUTED = 'ROUTED',
  IN_PREPARATION = 'IN_PREPARATION',
  READY = 'READY',
  SERVED = 'SERVED',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

export enum UserRole {
  CUSTOMER = 'customer',
  WAITER = 'waiter',
  KITCHEN_STAFF = 'kitchen_staff',
  BAR_STAFF = 'bar_staff',
  DOOR_STAFF = 'door_staff',
  MANAGER = 'manager',
  ADMIN = 'admin',
  SUPER_ADMIN = 'super_admin',
}

// ← NEW
export enum BusinessScope {
  CAR_RENTAL = 'CAR_RENTAL',
  APARTMENT = 'APARTMENT',
  TABLE_CLUB = 'TABLE_CLUB',
  EVENT_TICKETING = 'EVENT_TICKETING',
}

export enum CommissionPayer {
  USER = 'USER',   // User pays commission (added to total)
  ADMIN = 'ADMIN', // Admin pays commission (deducted from payout)
}

export enum AuditActionType {
  BOOKING_CREATED = 'BOOKING_CREATED',
  BOOKING_UPDATED = 'BOOKING_UPDATED',
  BOOKING_CANCELLED = 'BOOKING_CANCELLED',
  BOOKING_EXPIRED = 'BOOKING_EXPIRED',
  BOOKING_CHECKED_IN = 'BOOKING_CHECKED_IN',
  PAYMENT_PROCESSED = 'PAYMENT_PROCESSED',
  PAYMENT_REFUNDED = 'PAYMENT_REFUNDED',
  ORDER_CREATED = 'ORDER_CREATED',
  ORDER_ASSIGNED = 'ORDER_ASSIGNED',
  ORDER_COMPLETED = 'ORDER_COMPLETED',
  ADMIN_OVERRIDE = 'ADMIN_OVERRIDE',
  USER_CREATED = 'USER_CREATED',
  USER_UPDATED = 'USER_UPDATED',
  TICKET_SCANNED = 'TICKET_SCANNED',
  STAFF_DEACTIVATED = 'STAFF_DEACTIVATED',       // ← NEW
  STAFF_SCOPE_UPDATED = 'STAFF_SCOPE_UPDATED',   // ← NEW
  SETTINGS_UPDATED = 'SETTINGS_UPDATED',         // ← NEW
  CAMPAIGN_SENT = 'CAMPAIGN_SENT',               // ← NEW
  CAMPAIGN_FEE_CHARGED = 'CAMPAIGN_FEE_CHARGED', // ← NEW
  INVENTORY_RESTOCKED = 'INVENTORY_RESTOCKED',   // ← NEW
  INVENTORY_DEDUCTED = 'INVENTORY_DEDUCTED',     // ← NEW
  INVENTORY_ITEM_CREATED = 'INVENTORY_ITEM_CREATED', // ← NEW
  INVENTORY_ITEM_UPDATED = 'INVENTORY_ITEM_UPDATED', // ← NEW
  REFUND_INITIATED = 'REFUND_INITIATED',         // ← NEW
  WALLET_CREDITED = 'WALLET_CREDITED',           // ← NEW
  QUEUE_ADVANCED = 'QUEUE_ADVANCED',             // ← NEW
  QUEUE_CLOSED = 'QUEUE_CLOSED',                 // ← NEW
    // ← NEW — genuinely missing, not just unsynced: no prior value covered
  // these at all. wallet.service.ts's debit()/transfer() and
  // queues.service.ts's join/call/checkin/cancel were logging with
  // 'WALLET_DEBIT'/'WALLET_TRANSFER'/'QUEUE_JOINED'/'QUEUE_CALLED'/
  // 'QUEUE_CHECKIN'/'QUEUE_CANCELLED' cast through `as any` — none of
  // which exist anywhere, DB enum or TS enum. Every one of those calls
  // throws on insert. Named to match this enum's own past-tense convention
  // (WALLET_CREDITED, BOOKING_CANCELLED, etc.).
  WALLET_DEBITED = 'WALLET_DEBITED',  // ← NEW
  WALLET_TRANSFERRED = 'WALLET_TRANSFERRED',  // ← NEW
  QUEUE_JOINED = 'QUEUE_JOINED',  // ← NEW
  QUEUE_CALLED = 'QUEUE_CALLED',  // ← NEW
  QUEUE_CHECKED_IN = 'QUEUE_CHECKED_IN',  // ← NEW
  QUEUE_CANCELLED = 'QUEUE_CANCELLED',  // ← NEW
  CAUTION_FEE_REFUNDED = 'CAUTION_FEE_REFUNDED', // ← NEW
  CAUTION_FEE_FORFEITED = 'CAUTION_FEE_FORFEITED', // ← NEW
  PRICE_UPDATED = 'PRICE_UPDATED',               // ← NEW
  BUSINESS_CREATED = 'BUSINESS_CREATED',                 // ← NEW (multi-tenancy)
  BUSINESS_STATUS_CHANGED = 'BUSINESS_STATUS_CHANGED',   // ← NEW (multi-tenancy)
  STAFF_ASSIGNMENT_CREATED = 'STAFF_ASSIGNMENT_CREATED', // ← NEW (multi-tenancy)
  STAFF_ASSIGNMENT_REVOKED = 'STAFF_ASSIGNMENT_REVOKED', // ← NEW (multi-tenancy)
  DATA_SHARE_GRANTED = 'DATA_SHARE_GRANTED',             // ← NEW (multi-tenancy)
  DATA_SHARE_REVOKED = 'DATA_SHARE_REVOKED', 
              // ← NEW (multi-tenancy)
}

// ← NEW (multi-tenancy) — lifecycle status of a Business (tenant)
export enum BusinessStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  SUSPENDED = 'SUSPENDED',
  REJECTED = 'REJECTED',
}

// ← NEW (multi-tenancy) — data domains an owner can share between their own businesses
export enum BusinessShareDataType {
  INVENTORY = 'INVENTORY',
  ANALYTICS = 'ANALYTICS',
  CUSTOMER_DIRECTORY = 'CUSTOMER_DIRECTORY',
}