import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, In } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { User }    from '../../shared/entities/user.entity';
import { Booking } from '../../shared/entities/booking.entity';
import { Business } from '../../shared/entities/business.entity'; // ← NEW (multi-tenancy)
import { StaffBusinessAssignment } from '../../shared/entities/staff-business-assignment.entity'; // ← NEW (multi-tenancy)
import { BusinessDataShare } from '../../shared/entities/business-data-share.entity'; // ← NEW (Phase 5)
import { UserRole, AuditActionType, BookingStatus, BusinessScope, BusinessStatus, BusinessShareDataType } from '../../shared/enums';
import { AuditService }        from '../audit/audit.service';
import { NotificationService } from '../notifications/notifications.service';

@Injectable()
export class AdminService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Booking)
    private readonly bookingRepository: Repository<Booking>,
    @InjectRepository(StaffBusinessAssignment) // ← NEW (multi-tenancy)
    private readonly staffAssignmentRepository: Repository<StaffBusinessAssignment>,
    @InjectRepository(Business) // ← NEW (multi-tenancy)
    private readonly businessRepository: Repository<Business>,
    @InjectRepository(BusinessDataShare) // ← NEW (Phase 5)
    private readonly dataShareRepository: Repository<BusinessDataShare>,
    private readonly auditService: AuditService,
    private readonly notificationService: NotificationService,
  ) {}

  private generateOneTimePassword(): string {
    const upper  = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const digits = '23456789';
    const lower  = 'abcdefghjkmnpqrstuvwxyz';
    const rand   = (chars: string) => chars[crypto.randomInt(0, chars.length)];
    const core   = [rand(upper), rand(upper), rand(upper),
                    rand(digits), rand(digits), rand(digits),
                    rand(lower), rand(lower), rand(lower)];
    return core
      .map((c) => ({ c, sort: crypto.randomInt(0, 100) }))
      .sort((a, b) => a.sort - b.sort)
      .map((x) => x.c)
      .join('');
  }

  // Roles a business owner (or their manager) is allowed to create via the
  // staff endpoint. ADMIN and SUPER_ADMIN are deliberately excluded — new
  // business owners are onboarded by super admin only (a separate flow),
  // and this endpoint must never be usable to mint another admin/super
  // admin account.
  private static readonly ADDABLE_STAFF_ROLES = [
    UserRole.MANAGER, UserRole.WAITER, UserRole.KITCHEN_STAFF,
    UserRole.BAR_STAFF, UserRole.DOOR_STAFF,
  ];

  // ← CHANGED (multi-tenancy): addStaff now requires an explicit target
  // business and creates a StaffBusinessAssignment for it, in addition to
  // (still) setting the legacy businessOwnerId/businessScopes columns for
  // backward compatibility with anything not yet reading assignments.
  // A staff member can be assigned to further businesses afterwards via
  // assignStaffToBusiness — see PRD section 6.
  async addStaff(
    staffData: { email: string; firstName: string; lastName: string; role: UserRole; phone?: string; password?: string },
    creator: { id: string; role: UserRole; businessOwnerId?: string | null; businessScopes?: BusinessScope[] | null },
    ipAddress: string,
    businessId: string, // ← NEW (multi-tenancy) — the business this staff member is being added to
  ): Promise<User> {
    if (!AdminService.ADDABLE_STAFF_ROLES.includes(staffData.role)) {
      throw new BadRequestException(
        `Cannot create a staff member with role "${staffData.role}". Allowed roles: ${AdminService.ADDABLE_STAFF_ROLES.join(', ')}.`,
      );
    }
    if (!businessId) {
      throw new BadRequestException('A target business is required to add staff.');
    }

    const existing = await this.userRepository.findOne({ where: { email: staffData.email } });
    if (existing) throw new BadRequestException('A user with this email already exists');

    // Legacy businessOwnerId: if the creator is the owner themselves, it's
    // their own id; if the creator is a manager, inherit the chain so
    // staff always end up tied to the actual owner, not to the manager who
    // happened to create them. Kept for backward compatibility only —
    // StaffBusinessAssignment below is now the actual source of truth for
    // access.
    const businessOwnerId = creator.role === UserRole.ADMIN ? creator.id : creator.businessOwnerId;
    if (!businessOwnerId) {
      throw new BadRequestException('Your account is not linked to a business — cannot add staff.');
    }

    const temporaryPassword = staffData.password ?? this.generateOneTimePassword();
    const hashedPassword    = await bcrypt.hash(temporaryPassword, 12);

    const user = this.userRepository.create({
      email: staffData.email, passwordHash: hashedPassword,
      firstName: staffData.firstName, lastName: staffData.lastName,
      phone: staffData.phone, role: staffData.role, isActive: true,
      businessOwnerId,
      businessScopes: creator.businessScopes ?? null,
    });

    const savedUser = await this.userRepository.save(user) as User;

    // ← NEW (multi-tenancy) — the assignment that actually grants access.
    await this.staffAssignmentRepository.save(this.staffAssignmentRepository.create({
      userId: savedUser.id,
      businessId,
      role: staffData.role,
      scopes: creator.businessScopes ?? null,
      assignedBy: creator.id,
    }));

    await this.notificationService.sendNotification(
      savedUser.id,
      "Welcome to D'Lifestyle Staff Portal",
      `Your account has been created. Temporary password: ${temporaryPassword}. Please log in and change it immediately.`,
    );

    await this.auditService.logAction({
      actionType: AuditActionType.USER_CREATED, actorId: creator.id, actorRole: creator.role,
      resourceType: 'staff', resourceId: savedUser.id,
      changes: { email: staffData.email, role: staffData.role, businessId }, ipAddress,
    });

    const { passwordHash: _, ...safeUser } = savedUser as any;
    return safeUser;
  }

  // ← NEW (multi-tenancy) — grants an EXISTING staff member access to a
  // further business the caller (owner) also owns. This is the mechanism
  // behind both "assign staff to multiple businesses" and "grant a staff
  // member cross-business visibility" — see PRD section 6/7.2, they're the
  // same operation.
  async assignStaffToBusiness(
    staffId: string, businessId: string, role: UserRole, scopes: BusinessScope[] | null,
    actor: { id: string; role: UserRole }, ipAddress: string,
  ) {
    if (!AdminService.ADDABLE_STAFF_ROLES.includes(role)) {
      throw new BadRequestException(
        `Cannot assign role "${role}" through this endpoint. Allowed roles: ${AdminService.ADDABLE_STAFF_ROLES.join(', ')}.`,
      );
    }
    const user = await this.userRepository.findOne({ where: { id: staffId } });
    if (!user) throw new NotFoundException('Staff member not found');

    const existing = await this.staffAssignmentRepository.findOne({
      where: { userId: staffId, businessId, revokedAt: IsNull() },
    });
    if (existing) {
      throw new BadRequestException('This staff member already has an active assignment to that business.');
    }

    const assignment = await this.staffAssignmentRepository.save(this.staffAssignmentRepository.create({
      userId: staffId, businessId, role, scopes, assignedBy: actor.id,
    }));

    await this.auditService.logAction({
      actionType: AuditActionType.STAFF_ASSIGNMENT_CREATED, actorId: actor.id, actorRole: actor.role,
      resourceType: 'staff_business_assignment', resourceId: assignment.id,
      changes: { userId: staffId, businessId, role }, ipAddress,
    });

    return assignment;
  }

  // ← NEW (multi-tenancy) — revokes one specific business assignment. The
  // staff member's other assignments (if any) are untouched — this is what
  // makes "cross-business visibility" revocable per-business rather than
  // all-or-nothing.
  async revokeStaffAssignment(
    staffId: string, businessId: string, actor: { id: string; role: UserRole }, ipAddress: string,
  ) {
    const assignment = await this.staffAssignmentRepository.findOne({
      where: { userId: staffId, businessId, revokedAt: IsNull() },
    });
    if (!assignment) throw new NotFoundException('Active assignment not found for this staff member and business.');

    assignment.revokedAt = new Date();
    assignment.revokedBy = actor.id;
    await this.staffAssignmentRepository.save(assignment);

    await this.auditService.logAction({
      actionType: AuditActionType.STAFF_ASSIGNMENT_REVOKED, actorId: actor.id, actorRole: actor.role,
      resourceType: 'staff_business_assignment', resourceId: assignment.id,
      changes: { userId: staffId, businessId }, ipAddress,
    });

    return { message: 'Assignment revoked' };
  }

  // Onboards a new business owner (ADMIN role). Super admin only — this is
  // the one place an ADMIN account can be created; addStaff() explicitly
  // cannot create one, to keep owner onboarding a deliberate, separate act.
  async onboardBusinessOwner(
    ownerData: { email: string; firstName: string; lastName: string; phone?: string; password?: string; businessScopes: BusinessScope[] },
    superAdminId: string, ipAddress: string,
  ): Promise<User> {
    if (!ownerData.businessScopes?.length) {
      throw new BadRequestException('A business owner needs at least one business scope.');
    }

    const existing = await this.userRepository.findOne({ where: { email: ownerData.email } });
    if (existing) throw new BadRequestException('A user with this email already exists');

    const temporaryPassword = ownerData.password ?? this.generateOneTimePassword();
    const hashedPassword    = await bcrypt.hash(temporaryPassword, 12);

    const owner = this.userRepository.create({
      email: ownerData.email, passwordHash: hashedPassword,
      firstName: ownerData.firstName, lastName: ownerData.lastName,
      phone: ownerData.phone, role: UserRole.ADMIN, isActive: true,
      businessOwnerId: null, // owners are their own business owner, implicitly
      businessScopes: ownerData.businessScopes,
    });

    const savedOwner = await this.userRepository.save(owner) as User;

    // ← NEW (multi-tenancy) — every owner needs at least one Business to
    // actually create or manage anything (TenantScopeGuard resolves
    // "accessible businesses" from Business.ownerId; a User with none would
    // be locked out of every write endpoint). Super admin-onboarded owners
    // are pre-approved, unlike self-service registration (a later phase),
    // which would start at PENDING.
    const business = await this.businessRepository.save(this.businessRepository.create({
      ownerId: savedOwner.id,
      name: `${ownerData.firstName} ${ownerData.lastName}'s Business`,
      businessScopes: ownerData.businessScopes,
      status: BusinessStatus.APPROVED,
      isActive: true,
    }));

    await this.notificationService.sendNotification(
      savedOwner.id,
      "Welcome to D'Lifestyle",
      `Your business owner account has been created. Temporary password: ${temporaryPassword}. Please log in and change it immediately.`,
    );

    await this.auditService.logAction({
      actionType: AuditActionType.USER_CREATED, actorId: superAdminId, actorRole: UserRole.SUPER_ADMIN,
      resourceType: 'business_owner', resourceId: savedOwner.id,
      changes: { email: ownerData.email, businessScopes: ownerData.businessScopes, businessId: business.id }, ipAddress,
    });

    const { passwordHash: _, ...safeOwner } = savedOwner as any;
    return safeOwner;
  }

  // ← CHANGED (multi-tenancy): businessIds replaces the old single ownerId.
  // undefined = no restriction (super admin sees all staff across all
  // businesses). [] = restrict to nothing. Otherwise, restrict to staff
  // with an active StaffBusinessAssignment to any of those business(es) —
  // this also naturally surfaces staff an owner has granted cross-business
  // access to, not just staff created directly under this owner.
  async listStaff(params: { limit?: number; offset?: number; search?: string; role?: UserRole; businessIds?: string[] }) {
    if (params.businessIds && params.businessIds.length === 0) return { data: [], total: 0 };

    const staffRoles = [
      UserRole.WAITER, UserRole.KITCHEN_STAFF, UserRole.BAR_STAFF,
      UserRole.DOOR_STAFF, UserRole.MANAGER, UserRole.ADMIN,
    ];
    const qb = this.userRepository.createQueryBuilder('u')
      .select(['u.id', 'u.email', 'u.firstName', 'u.lastName', 'u.role',
               'u.isActive', 'u.businessScopes', 'u.businessOwnerId', 'u.lastLoginAt', 'u.createdAt'])
      .where('u.role IN (:...roles)', { roles: staffRoles })
      .andWhere('u.isDeleted = false');

    if (params.businessIds) {
      qb.andWhere(
        `u.id IN (
           SELECT "userId" FROM staff_business_assignments
           WHERE "businessId" IN (:...businessIds) AND "revokedAt" IS NULL
         )`,
        { businessIds: params.businessIds },
      );
    }
    if (params.search) {
      qb.andWhere('(u.email ILIKE :s OR u.firstName ILIKE :s OR u.lastName ILIKE :s)',
        { s: `%${params.search}%` });
    }
    if (params.role) qb.andWhere('u.role = :role', { role: params.role });
    qb.take(params.limit ?? 50).skip(params.offset ?? 0).orderBy('u.createdAt', 'DESC');
    const [data, total] = await qb.getManyAndCount();
    return { data, total };
  }

  async getStaffDetails(staffId: string, businessIds?: string[]) {
    const user = await this.userRepository.findOne({
      where: { id: staffId },
      select: ['id', 'email', 'firstName', 'lastName', 'role',
               'isActive', 'businessScopes', 'businessOwnerId', 'lastLoginAt', 'createdAt'],
    });
    if (!user) throw new NotFoundException('Staff member not found');

    // ← NEW (multi-tenancy) — the full set of businesses/roles this staff
    // member is currently assigned to (not just the one in the caller's
    // scope), so the owner can see the complete picture at a glance.
    const assignments = await this.staffAssignmentRepository.find({
      where: { userId: staffId, revokedAt: IsNull() },
    });

    if (businessIds !== undefined) {
      const hasAccess = assignments.some((a) => businessIds.includes(a.businessId));
      if (!businessIds.length || !hasAccess) {
        throw new NotFoundException('Staff member not found');
      }
    }

    return { ...user, assignments };
  }

  // ← CHANGED (multi-tenancy): role is now updated on a SPECIFIC
  // StaffBusinessAssignment (identified by businessId), not just the
  // global User.role column — this is what actually allows "Manager at
  // Business A, Waiter at Business B" to be true.
  //
  // IMPORTANT CAVEAT: this codebase's @Roles() route guard (RolesGuard)
  // checks the single global User.role column, not any per-business value
  // — it has no concept of "the caller's role in the currently active
  // business." So changing an assignment's role here is reflected in data
  // and in getStaffDetails()/listStaff(), but does NOT by itself change
  // what routes that staff member can call. To keep the common case (a
  // staff member with exactly one active assignment) behaving exactly as
  // before, we also update User.role — this is correct there because
  // "their one business's role" and "their global role" are the same
  // thing. For a staff member with MORE than one active assignment, the
  // two can now legitimately differ; making RolesGuard business-aware is
  // a larger change (touches every guarded route) intentionally deferred.
  async updateStaffRole(
    staffId: string, businessId: string, newRole: UserRole, actor: { id: string; role: UserRole },
    businessIds: string[] | undefined, ipAddress: string,
  ) {
    if (!AdminService.ADDABLE_STAFF_ROLES.includes(newRole)) {
      throw new BadRequestException(
        `Cannot set role to "${newRole}" through this endpoint. Allowed roles: ${AdminService.ADDABLE_STAFF_ROLES.join(', ')}.`,
      );
    }
    if (businessIds !== undefined && (!businessIds.length || !businessIds.includes(businessId))) {
      throw new NotFoundException('Staff member not found');
    }

    const user = await this.userRepository.findOne({ where: { id: staffId } });
    if (!user) throw new NotFoundException('Staff member not found');
    if (user.role === UserRole.SUPER_ADMIN)
      throw new BadRequestException('SUPER_ADMIN role cannot be changed through this endpoint');

    const assignment = await this.staffAssignmentRepository.findOne({
      where: { userId: staffId, businessId, revokedAt: IsNull() },
    });
    if (!assignment) throw new NotFoundException('This staff member has no active assignment to that business.');

    const oldAssignmentRole = assignment.role;
    assignment.role = newRole;
    await this.staffAssignmentRepository.save(assignment);

    // Keep the legacy global User.role in sync for the common single-
    // assignment case (see caveat above) — this is what RolesGuard and
    // every @Roles() check actually reads today.
    const activeAssignmentCount = await this.staffAssignmentRepository.count({
      where: { userId: staffId, revokedAt: IsNull() },
    });
    const oldGlobalRole = user.role;
    let globalRoleChanged = false;
    if (activeAssignmentCount <= 1) {
      user.role = newRole;
      globalRoleChanged = true;
      await this.userRepository.save(user);
    }

    await this.auditService.logAction({
      actionType: AuditActionType.USER_UPDATED, actorId: actor.id, actorRole: actor.role,
      resourceType: 'staff_business_assignment', resourceId: assignment.id,
      changes: {
        before: { assignmentRole: oldAssignmentRole, globalRole: oldGlobalRole },
        after: { assignmentRole: newRole, globalRole: globalRoleChanged ? newRole : oldGlobalRole },
        businessId,
        note: globalRoleChanged
          ? 'Single active assignment — global User.role updated to match.'
          : 'Multiple active assignments — global User.role left unchanged; only this business\'s assignment role was updated.',
      },
      ipAddress,
    });

    return {
      message: 'Role updated',
      businessId,
      role: newRole,
      globalRoleUpdated: globalRoleChanged,
    };
  }

  async deactivateStaff(
    staffId: string, actor: { id: string; role: UserRole },
    businessIds: string[] | undefined, ipAddress: string,
  ) {
    const user = await this.userRepository.findOne({ where: { id: staffId } });
    if (!user) throw new NotFoundException('Staff member not found');
    if (user.role === UserRole.SUPER_ADMIN)
      throw new BadRequestException('SUPER_ADMIN accounts cannot be deactivated here');

    if (businessIds !== undefined) {
      const anyMatch = businessIds.length
        ? await this.staffAssignmentRepository
            .createQueryBuilder('sba')
            .where('sba."userId" = :staffId', { staffId })
            .andWhere('sba."businessId" IN (:...businessIds)', { businessIds })
            .andWhere('sba."revokedAt" IS NULL')
            .getExists()
        : false;
      if (!anyMatch) throw new NotFoundException('Staff member not found');
    }

    user.isActive = false;
    await this.userRepository.save(user);
    await this.auditService.logAction({
      actionType: AuditActionType.STAFF_DEACTIVATED, actorId: actor.id, actorRole: actor.role,
      resourceType: 'user', resourceId: staffId,
      changes: { before: { isActive: true }, after: { isActive: false } }, ipAddress,
    });
    return { message: 'Staff member deactivated' };
  }

  async overrideBookingStatus(
    bookingId: string, newStatus: BookingStatus, adminId: string, ipAddress: string,
  ): Promise<Booking> {
    const booking = await this.bookingRepository.findOne({ where: { id: bookingId } });
    if (!booking) throw new NotFoundException('Booking not found');
    const oldStatus = booking.status;
    booking.status  = newStatus;
    const updated   = await this.bookingRepository.save(booking);
    await this.auditService.logAction({
      actionType: AuditActionType.ADMIN_OVERRIDE, actorId: adminId, actorRole: UserRole.ADMIN,
      resourceType: 'booking', resourceId: bookingId,
      changes: { status: { from: oldStatus, to: newStatus } }, ipAddress,
    });
    return updated;
  }

  // ══════════════════════════════════════════════════════════════════════
  // Phase 5 — BusinessDataShare management (PRD section 7)
  // ══════════════════════════════════════════════════════════════════════

  /**
   * Grants a data share from one of the caller's businesses to another —
   * both MUST be owned by the same person (the caller), enforced here, not
   * just assumed. Only the owner can grant sharing; managers/staff cannot,
   * since this is an ownership-level decision about what crosses a
   * business boundary.
   */
  async grantDataShare(
    fromBusinessId: string, toBusinessId: string, dataTypes: BusinessShareDataType[],
    actor: { id: string; role: UserRole }, ipAddress: string,
  ) {
    if (fromBusinessId === toBusinessId) {
      throw new BadRequestException('A business cannot share data with itself.');
    }
    if (!dataTypes?.length) {
      throw new BadRequestException('Select at least one data type to share.');
    }

    const [fromBiz, toBiz] = await Promise.all([
      this.businessRepository.findOne({ where: { id: fromBusinessId } }),
      this.businessRepository.findOne({ where: { id: toBusinessId } }),
    ]);
    if (!fromBiz || !toBiz) throw new NotFoundException('One or both businesses not found.');

    // Ownership-level action — the caller must own BOTH businesses (or be
    // super admin). A manager assigned to one business cannot grant it
    // access to another, even one they're also assigned to.
    if (actor.role !== UserRole.SUPER_ADMIN) {
      if (fromBiz.ownerId !== actor.id || toBiz.ownerId !== actor.id) {
        throw new ForbiddenException('You can only share data between businesses you own.');
      }
    }

    const existing = await this.dataShareRepository.findOne({
      where: { fromBusinessId, toBusinessId, revokedAt: IsNull() },
    });
    if (existing) {
      // Extend the existing grant's data types rather than creating a
      // duplicate row for the same business pair.
      const merged = Array.from(new Set([...existing.dataTypes, ...dataTypes]));
      existing.dataTypes = merged;
      const saved = await this.dataShareRepository.save(existing);
      await this.auditService.logAction({
        actionType: AuditActionType.DATA_SHARE_GRANTED, actorId: actor.id, actorRole: actor.role,
        resourceType: 'business_data_share', resourceId: saved.id,
        changes: { fromBusinessId, toBusinessId, dataTypes: merged, extended: true }, ipAddress,
      });
      return saved;
    }

    const share = await this.dataShareRepository.save(this.dataShareRepository.create({
      fromBusinessId, toBusinessId, dataTypes, grantedBy: actor.id,
    }));

    await this.auditService.logAction({
      actionType: AuditActionType.DATA_SHARE_GRANTED, actorId: actor.id, actorRole: actor.role,
      resourceType: 'business_data_share', resourceId: share.id,
      changes: { fromBusinessId, toBusinessId, dataTypes }, ipAddress,
    });

    return share;
  }

  async revokeDataShare(shareId: string, actor: { id: string; role: UserRole }, ipAddress: string) {
    const share = await this.dataShareRepository.findOne({ where: { id: shareId, revokedAt: IsNull() } });
    if (!share) throw new NotFoundException('Active data share not found.');

    if (actor.role !== UserRole.SUPER_ADMIN) {
      const fromBiz = await this.businessRepository.findOne({ where: { id: share.fromBusinessId } });
      if (!fromBiz || fromBiz.ownerId !== actor.id) {
        throw new ForbiddenException('You can only revoke shares from a business you own.');
      }
    }

    share.revokedAt = new Date();
    share.revokedBy = actor.id;
    await this.dataShareRepository.save(share);

    await this.auditService.logAction({
      actionType: AuditActionType.DATA_SHARE_REVOKED, actorId: actor.id, actorRole: actor.role,
      resourceType: 'business_data_share', resourceId: share.id,
      changes: { fromBusinessId: share.fromBusinessId, toBusinessId: share.toBusinessId }, ipAddress,
    });

    return { message: 'Data share revoked' };
  }

  /** Lists every active share where any of the caller's businesses is either the source or the recipient. */
  async listDataShares(businessIds?: string[]) {
    if (businessIds && businessIds.length === 0) return [];
    const qb = this.dataShareRepository.createQueryBuilder('s').where('s."revokedAt" IS NULL');
    if (businessIds) {
      qb.andWhere('(s."fromBusinessId" IN (:...ids) OR s."toBusinessId" IN (:...ids))', { ids: businessIds });
    }
    return qb.orderBy('s."createdAt"', 'DESC').getMany();
  }

  // ══════════════════════════════════════════════════════════════════════
  // Business listing — needed by the admin dashboard's business switcher
  // (an owner/staff with more than one business needs to see which ones
  // they can pick from, and which one is "theirs" vs. just assigned-to).
  // ══════════════════════════════════════════════════════════════════════

  async listMyBusinesses(user: { id: string; role: UserRole }, businessIds: string[] | undefined) {
    if (user.role === UserRole.SUPER_ADMIN) {
      // Super admin isn't scoped to specific businesses day-to-day, but
      // still benefits from being able to see/select any of them (e.g.
      // for support/troubleshooting via the same switcher UI).
      return this.businessRepository.find({ order: { createdAt: 'DESC' } });
    }
    if (!businessIds || businessIds.length === 0) return [];

    const businesses = await this.businessRepository.find({
      where: { id: In(businessIds) },
      order: { createdAt: 'DESC' },
    });
    // Flag which ones the caller actually owns (vs. is merely assigned to
    // as staff) — the switcher UI treats these differently (e.g. only an
    // owner can grant sharing or edit platform-adjacent settings for it).
    return businesses.map((b) => ({ ...b, isOwner: b.ownerId === user.id }));
  }

  // ← NEW (owner-facing business settings) — the caller must OWN the
  // business (not merely be staff assigned to it) to edit these fields.
  // Deliberately does NOT allow editing businessScopes or status — those
  // stay super-admin-only (see SuperAdminService.updateBusinessScopes /
  // updateBusinessStatus), matching the "do what's easy now" decision on
  // who controls a business's capabilities and lifecycle.
  async updateMyBusiness(
    businessId: string,
    dto: { name?: string; payoutDetails?: Record<string, any>; isActive?: boolean },
    actor: { id: string; role: UserRole },
    ipAddress: string,
  ) {
    const business = await this.businessRepository.findOne({ where: { id: businessId } });
    if (!business) throw new NotFoundException('Business not found');

    if (actor.role !== UserRole.SUPER_ADMIN && business.ownerId !== actor.id) {
      throw new ForbiddenException('Only the business owner can edit these settings.');
    }

    const before = { name: business.name, payoutDetails: business.payoutDetails, isActive: business.isActive };

    if (dto.name !== undefined) business.name = dto.name;
    if (dto.payoutDetails !== undefined) business.payoutDetails = dto.payoutDetails;
    if (dto.isActive !== undefined) business.isActive = dto.isActive;

    await this.businessRepository.save(business);

    await this.auditService.logAction({
      actionType: AuditActionType.BUSINESS_STATUS_CHANGED, actorId: actor.id, actorRole: actor.role,
      resourceType: 'business', resourceId: businessId,
      changes: { before, after: { name: business.name, payoutDetails: business.payoutDetails, isActive: business.isActive } },
      ipAddress,
    });

    return business;
  }

  async getMyBusiness(businessId: string, user: { id: string; role: UserRole }, businessIds?: string[]) {
    if (user.role !== UserRole.SUPER_ADMIN && businessIds !== undefined) {
      if (!businessIds.includes(businessId)) {
        throw new ForbiddenException('You do not have access to this business');
      }
    }
    const business = await this.businessRepository.findOne({ where: { id: businessId } });
    if (!business) throw new NotFoundException('Business not found');
    return { ...business, isOwner: business.ownerId === user.id };
  }

  async createMyBusiness(
    dto: { name: string; businessScopes: BusinessScope[]; payoutDetails?: Record<string, any> },
    user: { id: string; role: UserRole },
    ipAddress: string,
  ) {
    if (!dto.businessScopes?.length) {
      throw new BadRequestException('A business needs at least one business scope.');
    }
    const business = this.businessRepository.create({
      ownerId: user.id,
      name: dto.name,
      businessScopes: dto.businessScopes,
      payoutDetails: dto.payoutDetails || null,
      status: BusinessStatus.APPROVED,
      isActive: true,
    });
    const saved = await this.businessRepository.save(business);

    await this.auditService.logAction({
      actionType: AuditActionType.BUSINESS_CREATED,
      actorId: user.id,
      actorRole: user.role,
      resourceType: 'business',
      resourceId: saved.id,
      changes: { name: saved.name, businessScopes: saved.businessScopes },
      ipAddress,
    });

    return { ...saved, isOwner: true };
  }
}