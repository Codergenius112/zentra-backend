import { BookingType, BusinessScope, UserRole } from '../enums';
import { Brackets, WhereExpressionBuilder } from 'typeorm';
import type { OwnedResourceIds } from '../services/ownership-resolver.service';

const SCOPE_TO_BOOKING_TYPE: Record<BusinessScope, BookingType> = {
  [BusinessScope.EVENT_TICKETING]: BookingType.TICKET,
  [BusinessScope.TABLE_CLUB]:      BookingType.TABLE,
  [BusinessScope.APARTMENT]:       BookingType.APARTMENT,
  [BusinessScope.CAR_RENTAL]:      BookingType.CAR,
  [BusinessScope.JET_CHARTER]:     BookingType.JET,
};

/**
 * Maps a user's assigned business scopes to the booking types they're
 * allowed to see. Returns `undefined` for SUPER_ADMIN (no restriction —
 * sees everything system-wide). Returns an empty array for a scoped user
 * with no assigned businesses (sees nothing, rather than everything).
 */
export function bookingTypesForUser(user: { role: string; businessScopes?: BusinessScope[] | null }): BookingType[] | undefined {
  if (user.role === UserRole.SUPER_ADMIN) return undefined;
  const scopes = user.businessScopes ?? [];
  return scopes.map((s) => SCOPE_TO_BOOKING_TYPE[s]).filter(Boolean);
}

/**
 * Checks whether a user is allowed to access a feature gated by one or more
 * business scopes. SUPER_ADMIN always passes. A scoped user passes if they
 * have at least one of the given scopes assigned.
 */
export function hasBusinessScope(
  user: { role: string; businessScopes?: BusinessScope[] | null },
  required: BusinessScope | BusinessScope[],
): boolean {
  if (user.role === UserRole.SUPER_ADMIN) return true;
  const requiredScopes = Array.isArray(required) ? required : [required];
  const userScopes = user.businessScopes ?? [];
  return requiredScopes.some((s) => userScopes.includes(s));
}

/**
 * Resolves the business owner a resource-ownership check should filter by.
 * - Business owner (ADMIN): their own id IS the owner id.
 * - Staff (Manager/Waiter/Bar/Kitchen/Door): their businessOwnerId — the
 *   ADMIN they work for.
 * - Super admin: undefined — pure overseer, no ownership restriction.
 * - Anyone else (unassigned staff, customer): null — matches nothing, a
 *   safe default-deny rather than accidentally seeing everything.
 */
export function effectiveOwnerId(
  user: { id: string; role: string; businessOwnerId?: string | null },
): string | null | undefined {
  if (user.role === UserRole.SUPER_ADMIN) return undefined;
  if (user.role === UserRole.ADMIN) return user.id;
  return user.businessOwnerId ?? null;
}

/**
 * Adds a precise ownership filter to a query builder already filtered by
 * booking type category (via bookingTypesForUser). bookingCol/resourceCol
 * are the column references as they appear in the query — e.g. 'b.bookingType'
 * and 'b.resourceId', or 'booking.bookingType' for an order-scoping query.
 * If a booking type has no owned resources at all, it contributes no rows
 * rather than matching everything (empty IN() would be invalid SQL, so it's
 * only added when there's at least one id).
 */
export function applyOwnedResourceFilter(
  qb: { andWhere: (w: any) => any },
  bookingCol: string,
  resourceCol: string,
  owned: OwnedResourceIds,
  bookingTypeValues: { table: string; apartment: string; car: string; ticket: string },
): void {
  qb.andWhere(new Brackets((sub: WhereExpressionBuilder) => {
    let addedAny = false;
    const addClause = (type: string, ids: string[], paramName: string) => {
      if (!ids.length) return;
      const clause = `(${bookingCol} = :${paramName}_type AND ${resourceCol} IN (:...${paramName}_ids))`;
      const params = { [`${paramName}_type`]: type, [`${paramName}_ids`]: ids };
      addedAny ? sub.orWhere(clause, params) : sub.where(clause, params);
      addedAny = true;
    };
    addClause(bookingTypeValues.table,     owned.tableListingIds,     'tbl');
    addClause(bookingTypeValues.apartment, owned.apartmentListingIds, 'apt');
    addClause(bookingTypeValues.car,       owned.carListingIds,       'car');
    addClause(bookingTypeValues.ticket,    owned.eventIds,            'evt');
    // No owned resources of any type at all — match nothing.
    if (!addedAny) sub.where('1 = 0');
  }));
}
