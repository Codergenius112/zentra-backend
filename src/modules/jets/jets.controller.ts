import {
  Controller, Post, Get, Patch, Delete,
  Body, Param, Query, UseGuards, HttpCode, BadRequestException, ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantScopeGuard } from '../../common/guards/tenant-scope.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { IpAddress } from '../../common/decorators/ip-address.decorator';
import { BusinessIds, ActiveBusinessId, ActiveBusinessScopes } from '../../common/decorators/business-context.decorator';
import { JetsService, CreateJetBookingDto } from './jets.service';
import { JetListingsService, CreateJetListingDto, UpdateJetListingDto } from './jet-listings.service';
import { UserRole, BusinessScope } from '../../shared/enums';
import { effectiveOwnerId, hasBusinessScope } from '../../shared/utils/business-scope.util';

@ApiTags('Jets')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantScopeGuard, RolesGuard)
@Controller('jets')
export class JetsController {
  constructor(
    private readonly jetsService: JetsService,
    private readonly jetListingsService: JetListingsService,
  ) {}

  @Get('listings')
  @Roles(UserRole.CUSTOMER, UserRole.ADMIN, UserRole.MANAGER, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'List available jet/charter listings' })
  async getListings(
    @CurrentUser() user: any,
    @Query('category') category?: string,
    @Query('city') city?: string,
    @Query('minCapacity') minCapacity?: string,
    @Query('maxPrice') maxPrice?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @BusinessIds() businessIds?: string[],
  ) {
    const isStaff = [UserRole.ADMIN, UserRole.MANAGER, UserRole.SUPER_ADMIN].includes(user.role);
    return this.jetListingsService.getListings({
      category,
      city,
      minCapacity: minCapacity ? Number(minCapacity) : undefined,
      maxPrice: maxPrice ? Number(maxPrice) : undefined,
      limit: limit ? Number(limit) : 20,
      offset: offset ? Number(offset) : 0,
      businessIds: isStaff ? businessIds : undefined,
      activeOnly: !isStaff,
    });
  }

  @Get('listings/:id')
  @Roles(UserRole.CUSTOMER, UserRole.ADMIN, UserRole.MANAGER, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Get jet listing details by id' })
  async getListing(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @BusinessIds() businessIds?: string[],
  ) {
    const isStaff = [UserRole.ADMIN, UserRole.MANAGER, UserRole.SUPER_ADMIN].includes(user.role);
    return this.jetListingsService.getListing(id, isStaff ? businessIds : undefined);
  }

  @Post('listings')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @HttpCode(201)
  @ApiOperation({ summary: 'Create a new jet charter listing for the active business' })
  async createListing(
    @Body() dto: CreateJetListingDto,
    @CurrentUser() user: any,
    @ActiveBusinessId() activeBusinessId?: string | null,
    @ActiveBusinessScopes() activeBusinessScopes?: BusinessScope[],
  ) {
    if (!activeBusinessId) {
      throw new BadRequestException(
        'Could not determine which business this listing belongs to. If you manage more than one business, specify one via the X-Business-Id header.',
      );
    }
    if (!hasBusinessScope({ role: user.role, businessScopes: activeBusinessScopes }, BusinessScope.JET_CHARTER)) {
      throw new ForbiddenException('This business is not set up for jet charters — ask a super admin to add the JET_CHARTER scope.');
    }

    return this.jetListingsService.createListing({
      ...dto,
      managedBy: effectiveOwnerId(user),
      businessId: activeBusinessId,
    });
  }

  @Patch('listings/:id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Update jet listing details' })
  async updateListing(
    @Param('id') id: string,
    @Body() dto: UpdateJetListingDto,
    @CurrentUser() user: any,
    @BusinessIds() businessIds?: string[],
  ) {
    return this.jetListingsService.updateListing(id, dto, businessIds);
  }

  @Delete('listings/:id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Deactivate / delete jet listing' })
  async deleteListing(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @BusinessIds() businessIds?: string[],
  ) {
    return this.jetListingsService.deleteListing(id, businessIds);
  }

  // ── Customer Booking Endpoints ──────────────────────────────────────────────
  @Post()
  @Roles(UserRole.CUSTOMER, UserRole.ADMIN, UserRole.MANAGER, UserRole.SUPER_ADMIN)
  @HttpCode(201)
  @ApiOperation({ summary: 'Book a jet charter' })
  async bookJet(
    @Body() dto: CreateJetBookingDto,
    @CurrentUser() user: any,
    @IpAddress() ipAddress: string,
  ) {
    return this.jetsService.bookJet(user.id, dto, ipAddress);
  }

  @Get('my-bookings')
  @Roles(UserRole.CUSTOMER, UserRole.ADMIN, UserRole.MANAGER, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Get current customer jet bookings' })
  async getMyBookings(
    @CurrentUser() user: any,
    @Query('limit') limit = '20',
    @Query('offset') offset = '0',
  ) {
    const [bookings, total] = await this.jetsService.getUserJetBookings(
      user.id,
      Number(limit),
      Number(offset),
    );
    return { bookings, total };
  }

  @Get('bookings/:id')
  @Roles(UserRole.CUSTOMER, UserRole.ADMIN, UserRole.MANAGER, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Get single jet booking details' })
  async getBooking(
    @Param('id') id: string,
    @CurrentUser() user: any,
  ) {
    return this.jetsService.getJetBooking(id, user.id);
  }
}
