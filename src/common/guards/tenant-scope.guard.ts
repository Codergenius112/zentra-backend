import {
  Injectable, CanActivate, ExecutionContext, ForbiddenException,
} from '@nestjs/common';
import { BusinessContextService } from '../../shared/services/business-context.service';

/**
 * Resolves the caller's business context once per request and attaches it
 * for downstream controllers/services to use:
 *
 *   request.businessIds      — string[] | undefined (undefined = super admin)
 *   request.activeBusinessId — string | null
 *
 * activeBusinessId is used for WRITES that need exactly one business
 * target (e.g. "which business does this new walk-in booking belong to").
 * It's resolved as:
 *   - the "x-business-id" header, if the caller sent one (must be in their
 *     accessible set, otherwise 403);
 *   - otherwise, the caller's sole accessible business, if they only have one;
 *   - otherwise null (ambiguous — the caller must send the header).
 * Super admin may pass any businessId via the header, or omit it entirely
 * for cross-business actions.
 *
 * This guard does NOT reject requests for having no accessible businesses —
 * that's a legitimate state (e.g. a brand-new owner with none approved
 * yet) and is left to individual controllers/services to handle (usually
 * by returning empty results, per the existing convention in this codebase).
 */
@Injectable()
export class TenantScopeGuard implements CanActivate {
  constructor(private readonly businessContext: BusinessContextService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    if (!user) throw new ForbiddenException('Authentication required');

    const accessibleBusinessIds = await this.businessContext.getAccessibleBusinessIds(user);
    request.allAccessibleBusinessIds = accessibleBusinessIds;

    const headerBusinessId = (request.headers['x-business-id'] as string | undefined)?.trim() || undefined;

    let activeBusinessId: string | null = null;
    let scopedBusinessIds: string[] | undefined = accessibleBusinessIds;

    if (headerBusinessId) {
      if (accessibleBusinessIds !== undefined && !accessibleBusinessIds.includes(headerBusinessId)) {
        throw new ForbiddenException('You do not have access to the requested business.');
      }
      activeBusinessId = headerBusinessId;
      scopedBusinessIds = [headerBusinessId];
    } else if (accessibleBusinessIds !== undefined && accessibleBusinessIds.length === 1) {
      activeBusinessId = accessibleBusinessIds[0];
      scopedBusinessIds = [activeBusinessId];
    }

    request.businessIds = scopedBusinessIds;
    request.activeBusinessId = activeBusinessId;

    // ← NEW — Business.businessScopes is the real source of truth for
    // scope-gated actions (replacing the old per-User field). businessScopes
    // here is the UNION across every business the caller can act within
    // (for list/read gating — "do I have this capability ANYWHERE");
    // activeBusinessScopes is the SPECIFIC target business's own scopes
    // (for create — "does THIS business support what I'm about to make").
    request.businessScopes = await this.businessContext.getScopesForBusinesses(accessibleBusinessIds);
    request.activeBusinessScopes = await this.businessContext.getBusinessScopes(activeBusinessId);

    // ← NEW (RolesGuard business-awareness fix) — the caller's role for the
    // SPECIFIC active business, which may differ from their global
    // User.role (e.g. "waiter" globally but "manager" at this one
    // business). RolesGuard reads this instead of the raw user.role when
    // it's available. Requires TenantScopeGuard to run BEFORE RolesGuard —
    // see the guard ordering on each controller.
    request.effectiveRole = await this.businessContext.getEffectiveRole(user, activeBusinessId);

    return true;
  }
}
