import {
  Controller, Get, Post, Patch, Param, Body, UseGuards, HttpCode,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard }   from '../../common/guards/roles.guard';
import { TenantScopeGuard } from '../../common/guards/tenant-scope.guard';
import { Roles }        from '../../common/decorators/roles.decorator';
import { CurrentUser }  from '../../common/decorators/current-user.decorator';
import { IpAddress }    from '../../common/decorators/ip-address.decorator';
import { AllAccessibleBusinessIds, BusinessIds }  from '../../common/decorators/business-context.decorator';
import { AdminService } from './admin.service';
import { UserRole, BusinessScope } from '../../shared/enums';
import { IsString, IsOptional, IsObject, IsBoolean, IsArray, IsEnum } from 'class-validator';

class CreateMyBusinessDto {
  @IsString() name: string;
  @IsArray() @IsEnum(BusinessScope, { each: true }) businessScopes: BusinessScope[];
  @IsOptional() @IsObject() payoutDetails?: Record<string, any>;
}

class UpdateMyBusinessDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsObject() payoutDetails?: Record<string, any>;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

// Powers the admin dashboard's business switcher and business management
@ApiTags('Admin - Businesses')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantScopeGuard, RolesGuard)
@Controller('admin/businesses')
export class AdminBusinessesController {
  constructor(private readonly adminService: AdminService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.WAITER, UserRole.KITCHEN_STAFF, UserRole.BAR_STAFF, UserRole.DOOR_STAFF, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'List every business the caller can act within (owned + assigned-to)' })
  async listMyBusinesses(@CurrentUser() user: any, @AllAccessibleBusinessIds() businessIds?: string[]) {
    return this.adminService.listMyBusinesses(user, businessIds);
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @HttpCode(201)
  @ApiOperation({ summary: 'Create a new business tenant under the caller' })
  async createMyBusiness(
    @Body() dto: CreateMyBusinessDto,
    @CurrentUser() user: any,
    @IpAddress() ip: string,
  ) {
    return this.adminService.createMyBusiness(dto, user, ip);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Get business details by id' })
  async getMyBusiness(
    @Param('id') businessId: string,
    @CurrentUser() user: any,
    @AllAccessibleBusinessIds() businessIds?: string[],
  ) {
    return this.adminService.getMyBusiness(businessId, user, businessIds);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @HttpCode(200)
  @ApiOperation({ summary: "Update a business's own settings (name, payout details, active toggle) — owner only" })
  async updateMyBusiness(
    @Param('id') businessId: string,
    @Body() dto: UpdateMyBusinessDto,
    @CurrentUser() user: any,
    @IpAddress() ip: string,
  ) {
    return this.adminService.updateMyBusiness(businessId, dto, user, ip);
  }
}
