import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { UserRole, BookingType, BusinessStatus, BusinessShareDataType, BusinessScope } from '../enums';

/**
 * The Phase 2 counterpart to OwnershipResolverService. Where that service
 * answers "which resource ids does this owner control" (used by the admin
 * controllers/services NOT yet migrated to businessId — see the Phase 2
 * handover notes), this service answers the two questions the businessId
 * columns (added in Phase 0/1) make cheap to answer directly:
 *
 *   1. Which business id(s) can this caller act as? (getAccessibleBusinessIds)
 *   2. Given a resource, which business does it belong to? (resolveBusinessIdForBooking)
 *
 * Both a business owner and their assigned staff can have access to more
 * than one business, so the result here is always a set of ids, not a
 * single owner id — this is the key difference from the old model.
 */
@Injectable()
export class BusinessContextService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * Returns the set of business ids this user may act within.
   * - SUPER_ADMIN → undefined (no restriction, sees/acts on everything).
   * - Everyone else → string[] (owned businesses ∪ active staff assignments).
   *   An empty array is a valid, meaningful result: a real account with no
   *   business access at all, not "no restriction".
   */
  async getAccessibleBusinessIds(user: { id: string; role: string }): Promise<string[] | undefined> {
    if (user.role === UserRole.SUPER_ADMIN) return undefined;

    const [ownedRows, assignedRows] = await Promise.all([
      this.dataSource.query(
        `SELECT id FROM businesses WHERE "ownerId" = $1 AND "isDeleted" = false`,
        [user.id],
      ),
      this.dataSource.query(
        `SELECT DISTINCT sba."businessId" AS id
         FROM staff_business_assignments sba
         JOIN businesses b ON b.id = sba."businessId"
         WHERE sba."userId" = $1 AND sba."revokedAt" IS NULL AND b."isDeleted" = false`,
        [user.id],
      ),
    ]);

    const ids = new Set<string>([
      ...ownedRows.map((r: any) => r.id),
      ...assignedRows.map((r: any) => r.id),
    ]);
    return Array.from(ids);
  }

  /**
   * Given a booking's type + resourceId, resolves the business that owns
   * the underlying listing. Mirrors OwnershipResolverService's join logic,
   * but resolves forward (resource → business) rather than backward
   * (owner → all their resource ids) — used at booking-creation time so
   * every new booking is stamped with a businessId, not just backfilled
   * historical ones.
   */
  async resolveBusinessIdForBooking(bookingType: BookingType | string, resourceId: string): Promise<string | null> {
    switch (bookingType) {
      case BookingType.TABLE: {
        const rows = await this.dataSource.query(
          `SELECT COALESCE(v."businessId", ev."businessId") AS "businessId"
           FROM table_listings tl
           LEFT JOIN venues v ON v.id = tl."venueId"
           LEFT JOIN events ev ON ev.id = tl."eventId"
           WHERE tl.id = $1`,
          [resourceId],
        );
        return rows[0]?.businessId ?? null;
      }
      case BookingType.APARTMENT: {
        const rows = await this.dataSource.query(
          `SELECT "businessId" FROM apartment_listings WHERE id = $1`, [resourceId],
        );
        return rows[0]?.businessId ?? null;
      }
      case BookingType.CAR: {
        const rows = await this.dataSource.query(
          `SELECT "businessId" FROM car_listings WHERE id = $1`, [resourceId],
        );
        return rows[0]?.businessId ?? null;
      }
      case BookingType.JET: {
        const rows = await this.dataSource.query(
          `SELECT "businessId" FROM jet_listings WHERE id = $1`, [resourceId],
        );
        return rows[0]?.businessId ?? null;
      }
      case BookingType.TICKET: {
        // resourceId = eventId directly (see OwnershipResolverService).
        const rows = await this.dataSource.query(
          `SELECT "businessId" FROM events WHERE id = $1`, [resourceId],
        );
        return rows[0]?.businessId ?? null;
      }
      default:
        return null;
    }
  }

  /** Resolves a venue's businessId directly — used by manual/walk-in flows. */
  async resolveBusinessIdForVenue(venueId: string): Promise<string | null> {
    const rows = await this.dataSource.query(`SELECT "businessId" FROM venues WHERE id = $1`, [venueId]);
    return rows[0]?.businessId ?? null;
  }

  /** Resolves an event's businessId directly. */
  async resolveBusinessIdForEvent(eventId: string): Promise<string | null> {
    const rows = await this.dataSource.query(`SELECT "businessId" FROM events WHERE id = $1`, [eventId]);
    return rows[0]?.businessId ?? null;
  }

  /**
   * Throws if the given business is SUSPENDED. Called before any write that
   * changes booking/order state, so a suspended business's in-flight
   * activity freezes immediately (PRD section 5.4) rather than only being
   * blocked at the point of creating brand-new bookings.
   */
  async assertBusinessActive(businessId: string | null | undefined): Promise<void> {
    if (!businessId) return; // nothing to check — legacy/unscoped resource
    const rows = await this.dataSource.query(
      `SELECT status FROM businesses WHERE id = $1`, [businessId],
    );
    if (rows[0]?.status === BusinessStatus.SUSPENDED) {
      throw new ForbiddenException(
        'This business is currently suspended — no changes can be made until it is reinstated.',
      );
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // Phase 5 — BusinessDataShare enforcement (PRD section 7)
  // ══════════════════════════════════════════════════════════════════════

  /**
   * Given the caller's OWN business ids and a data type, returns the set of
   * OTHER businesses that have actively shared that data type in to any of
   * the caller's businesses. Used to expand a read query's scope beyond
   * strict ownership — e.g. "show me inventory from my own business(es)
   * PLUS whatever's been shared to me."
   */
  async getSharedInBusinessIds(
    toBusinessIds: string[] | undefined,
    dataType: BusinessShareDataType,
  ): Promise<string[]> {
    if (!toBusinessIds || toBusinessIds.length === 0) return [];
    const rows = await this.dataSource.query(
      `SELECT DISTINCT "fromBusinessId" AS id
       FROM business_data_shares
       WHERE "toBusinessId" = ANY($1::uuid[])
         AND "revokedAt" IS NULL
         AND $2 = ANY(string_to_array("dataTypes", ','))`,
      [toBusinessIds, dataType],
    );
    return rows.map((r: any) => r.id);
  }

  /**
   * The read-side counterpart used by controllers/services: caller's own
   * businessIds, expanded with anything actively shared in for this
   * dataType. undefined (super admin, no restriction) passes through
   * unchanged — sharing is meaningless when there's no restriction to
   * expand in the first place.
   */
  async resolveReadableBusinessIds(
    ownBusinessIds: string[] | undefined,
    dataType: BusinessShareDataType,
  ): Promise<string[] | undefined> {
    if (ownBusinessIds === undefined) return undefined; // super admin
    const shared = await this.getSharedInBusinessIds(ownBusinessIds, dataType);
    return Array.from(new Set([...ownBusinessIds, ...shared]));
  }

  /**
   * Write-side enforcement for a resource that may belong to the caller's
   * own business OR to a business that's shared data in to them. Per PRD
   * section 7.1: write access to shared data is Manager-role-only — every
   * other staff role (and every other data type without an active share)
   * is read-only or has no access at all.
   *
   * Throws ForbiddenException/NotFoundException as appropriate; returns
   * normally if the write is allowed.
   */
  async assertWriteAccess(
    resourceBusinessId: string | null | undefined,
    ownBusinessIds: string[] | undefined,
    actorId: string,
    dataType: BusinessShareDataType,
  ): Promise<void> {
    if (ownBusinessIds === undefined) return; // super admin — unrestricted
    if (!resourceBusinessId) return; // legacy/unscoped resource — nothing to check

    if (ownBusinessIds.includes(resourceBusinessId)) return; // caller owns/is assigned to it directly

    // Not directly owned — only reachable at all if it's been shared in.
    const sharedIds = await this.getSharedInBusinessIds(ownBusinessIds, dataType);
    if (!sharedIds.includes(resourceBusinessId)) {
      throw new NotFoundException('Resource not found');
    }

    // It IS shared in — but only a Manager (or the owner) of the receiving
    // business may write to it. Find which of the caller's own businesses
    // is actually receiving this share, then check the caller's role there.
    const receivingBusinessRows = await this.dataSource.query(
      `SELECT DISTINCT "toBusinessId" AS id
       FROM business_data_shares
       WHERE "fromBusinessId" = $1 AND "toBusinessId" = ANY($2::uuid[])
         AND "revokedAt" IS NULL
         AND $3 = ANY(string_to_array("dataTypes", ','))`,
      [resourceBusinessId, ownBusinessIds, dataType],
    );
    const receivingBusinessIds = receivingBusinessRows.map((r: any) => r.id);

    const isManagerOrOwner = await this.hasManagerOrOwnerAccess(actorId, receivingBusinessIds);
    if (!isManagerOrOwner) {
      throw new ForbiddenException(
        'Only a manager can modify data shared in from another business — you have read-only access to it.',
      );
    }
  }

  /**
   * True if actorId is either the owner of one of the given businesses, or
   * holds an active MANAGER assignment to one of them.
   */
  private async hasManagerOrOwnerAccess(actorId: string, businessIds: string[]): Promise<boolean> {
    if (!businessIds.length) return false;
    const rows = await this.dataSource.query(
      `SELECT 1 FROM businesses WHERE id = ANY($1::uuid[]) AND "ownerId" = $2
       UNION
       SELECT 1 FROM staff_business_assignments
       WHERE "businessId" = ANY($1::uuid[]) AND "userId" = $2
         AND role = 'manager' AND "revokedAt" IS NULL`,
      [businessIds, actorId],
    );
    return rows.length > 0;
  }

  // ══════════════════════════════════════════════════════════════════════
  // Business scope resolution — Business.businessScopes (what a business is
  // actually allowed to create/manage: TABLE_CLUB, EVENT_TICKETING, etc.)
  // is now the real source of truth for scope-gated actions, replacing the
  // old per-User businessScopes field that hasBusinessScope() previously
  // read. This is what lets one business legitimately run both a venue and
  // an event (multi-scope-per-business, confirmed in the PRD) with zero
  // extra wiring — same businessId, same staff, same data, automatically.
  // ══════════════════════════════════════════════════════════════════════

  /**
   * A single business's own scopes. Empty array if not found / no businessId. */
  async getBusinessScopes(businessId: string | null | undefined): Promise<BusinessScope[]> {
    if (!businessId) return [];
    const rows = await this.dataSource.query(
      `SELECT "businessScopes" FROM businesses WHERE id = $1`, [businessId],
    );
    const raw: string | null = rows[0]?.businessScopes ?? null;
    return raw ? (raw.split(',').filter(Boolean) as BusinessScope[]) : [];
  }

  /**
   * Union of scopes across several businesses — used for "does the caller
   * have this capability ANYWHERE among their businesses" checks (list/read
   * gating), not for deciding which specific business a new resource
   * belongs to (use getBusinessScopes with the target businessId for that).
   */
  async getScopesForBusinesses(businessIds: string[] | undefined): Promise<BusinessScope[] | undefined> {
    if (businessIds === undefined) return undefined; // super admin — unrestricted
    if (!businessIds.length) return [];
    const rows = await this.dataSource.query(
      `SELECT DISTINCT unnest(string_to_array("businessScopes", ',')) AS scope
       FROM businesses WHERE id = ANY($1::uuid[])`,
      [businessIds],
    );
    return rows.map((r: any) => r.scope).filter(Boolean);
  }

  // ══════════════════════════════════════════════════════════════════════
  // Effective role resolution — RolesGuard (the @Roles() route guard)
  // previously checked only the caller's single global User.role, which
  // never reflected a StaffBusinessAssignment's own role. A staff member
  // could be "waiter" globally but "manager" specifically at Business B —
  // route-level checks never saw that. This resolves the role that
  // actually applies for the CURRENT business context.
  // ══════════════════════════════════════════════════════════════════════

  /**
   * The caller's effective role for the given business:
   * - Super admin → their global role (always SUPER_ADMIN, bypasses
   *   @Roles() checks entirely regardless of what's returned here).
   * - The business's owner → their global role (owners aren't staff-
   *   assigned to their own business via StaffBusinessAssignment; they
   *   just own it, and keep their ADMIN role there always).
   * - Staff with an active assignment to this business → that
   *   assignment's OWN role, which may differ from their global role.
   * - No active assignment to this business (or businessId is null,
   *   e.g. an ambiguous multi-business caller who didn't specify one) →
   *   falls back to their global role, same as before this fix existed.
   */
  async getEffectiveRole(
    user: { id: string; role: UserRole },
    businessId: string | null | undefined,
  ): Promise<UserRole> {
    if (user.role === UserRole.SUPER_ADMIN) return user.role;
    if (!businessId) return user.role;

    const ownerRows = await this.dataSource.query(
      `SELECT 1 FROM businesses WHERE id = $1 AND "ownerId" = $2`, [businessId, user.id],
    );
    if (ownerRows.length) return user.role;

    const assignmentRows = await this.dataSource.query(
      `SELECT role FROM staff_business_assignments
       WHERE "userId" = $1 AND "businessId" = $2 AND "revokedAt" IS NULL
       LIMIT 1`,
      [user.id, businessId],
    );
    if (assignmentRows.length) return assignmentRows[0].role as UserRole;

    return user.role;
  }

  // ══════════════════════════════════════════════════════════════════════
  // Customer-relationship check — used by NotificationController's
  // admin-facing send/send-bulk/schedule endpoints, which previously let
  // any admin/manager message ANY userId on the platform with zero check
  // that the recipient has any relationship with the caller's business.
  // Kept out of NotificationService itself since that service is also
  // called internally for legitimate non-customer notifications (e.g.
  // staff welcome messages), which must NOT require a booking history.
  // ══════════════════════════════════════════════════════════════════════

  /** True if userId has at least one booking under any of the given businesses. */
  async isCustomerOfAnyBusiness(userId: string, businessIds: string[]): Promise<boolean> {
    if (!businessIds.length) return false;
    const rows = await this.dataSource.query(
      `SELECT 1 FROM bookings WHERE "userId" = $1 AND "businessId" = ANY($2::uuid[]) LIMIT 1`,
      [userId, businessIds],
    );
    return rows.length > 0;
  }

  /** Filters a list of userIds down to only those with a booking under any of the given businesses. */
  async filterCustomersOfAnyBusiness(userIds: string[], businessIds: string[]): Promise<string[]> {
    if (!userIds.length || !businessIds.length) return [];
    const rows = await this.dataSource.query(
      `SELECT DISTINCT "userId" FROM bookings WHERE "userId" = ANY($1::uuid[]) AND "businessId" = ANY($2::uuid[])`,
      [userIds, businessIds],
    );
    return rows.map((r: any) => r.userId);
  }

  /**
   * Every user (owner + active staff) belonging to any of the given
   * businesses. Used to scope resources that have no businessId column of
   * their own (e.g. NotificationCampaign, which is architecturally a
   * platform-wide broadcast tool with no per-business audience concept)
   * but DO record who created them — so "does this belong to my business"
   * is answered via the creator's identity instead of a direct businessId
   * check. Same pattern as AuditService.getBusinessAuditTrail.
   */
  async getActorIdsForBusinesses(businessIds: string[]): Promise<string[]> {
    if (!businessIds.length) return [];
    const rows = await this.dataSource.query(
      `SELECT "ownerId" AS id FROM businesses WHERE id = ANY($1::uuid[])
       UNION
       SELECT "userId" AS id FROM staff_business_assignments
       WHERE "businessId" = ANY($1::uuid[]) AND "revokedAt" IS NULL`,
      [businessIds],
    );
    return rows.map((r: any) => r.id);
  }
}
