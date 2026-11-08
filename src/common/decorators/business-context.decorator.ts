import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Extracts the businessIds attached to the request by TenantScopeGuard.
 * string[] | undefined — undefined means "no restriction" (super admin).
 * Requires TenantScopeGuard to run earlier in the guard chain.
 */
export const BusinessIds = createParamDecorator((data: unknown, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest();
  return request.businessIds;
});

/**
 * Extracts all accessible businessIds for the caller (owned + assigned).
 * Unlike BusinessIds, this is not narrowed by the active X-Business-Id header.
 */
export const AllAccessibleBusinessIds = createParamDecorator((data: unknown, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest();
  return request.allAccessibleBusinessIds ?? request.businessIds;
});

/**
 * Extracts the resolved single active business id for this request (see
 * TenantScopeGuard for resolution rules). string | null.
 */
export const ActiveBusinessId = createParamDecorator((data: unknown, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest();
  return request.activeBusinessId ?? null;
});

/**
 * Union of BusinessScope across every business the caller can act within.
 * undefined = super admin (unrestricted). Use for list/read gating — "does
 * the caller have this capability ANYWHERE among their businesses."
 */
export const BusinessScopes = createParamDecorator((data: unknown, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest();
  return request.businessScopes;
});

/**
 * The specific active business's own scopes (empty array if no active
 * business is resolved). Use for create/write gating — "does THIS
 * business support what's about to be made," not any of the caller's
 * other businesses.
 */
export const ActiveBusinessScopes = createParamDecorator((data: unknown, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest();
  return request.activeBusinessScopes ?? [];
});
