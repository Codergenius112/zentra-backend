import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  UseGuards,
  HttpCode,
  ForbiddenException,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantScopeGuard } from '../../common/guards/tenant-scope.guard'; // ← NEW (multi-tenancy — queues gap fix)
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { IpAddress } from '../../common/decorators/ip-address.decorator';
import { BusinessIds } from '../../common/decorators/business-context.decorator'; // ← NEW (multi-tenancy — queues gap fix)
import { QueuesService } from './queues.service';
import { BusinessContextService } from '../../shared/services/business-context.service'; // ← NEW (multi-tenancy — queues gap fix)
import { UserRole } from '../../shared/enums';

@ApiTags('Queues')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantScopeGuard, RolesGuard) // ← CHANGED (multi-tenancy — queues gap fix)
@Controller('queues')
export class QueuesController {
  constructor(
    private queuesService: QueuesService,
    private readonly businessContext: BusinessContextService, // ← NEW (multi-tenancy — queues gap fix)
  ) {}

  @Post()
  @Roles(UserRole.CUSTOMER)
  @HttpCode(201)
  async joinQueue(
    @Body() body: { venueId: string },
    @CurrentUser() user: any,
    @IpAddress() ipAddress: string,
  ) {
    return this.queuesService.joinQueue(body.venueId, user.id, ipAddress);
  }

  // ← CHANGED (multi-tenancy — queues gap fix): previously door staff or a
  // manager from ANY business could view the live queue status of ANY
  // venue by just passing a different venueId. Now checked against the
  // caller's own business(es) — customers remain unrestricted (they're
  // meant to check any venue's queue before deciding to join).
  @Get('venue/:venueId')
  @Roles(UserRole.CUSTOMER, UserRole.DOOR_STAFF, UserRole.MANAGER)
  async getVenueQueue(
    @Param('venueId') venueId: string,
    @CurrentUser() user: any,
    @BusinessIds() businessIds?: string[],
  ) {
    const isStaff = [UserRole.DOOR_STAFF, UserRole.MANAGER].includes(user.role);
    if (isStaff && businessIds !== undefined) {
      const venueBusinessId = await this.businessContext.resolveBusinessIdForVenue(venueId);
      if (!venueBusinessId || !businessIds.includes(venueBusinessId)) {
        throw new ForbiddenException('You are not assigned to this venue\'s business.');
      }
    }
    return this.queuesService.getVenueQueueStatus(venueId);
  }

  @Get('position/:queueId')
  @Roles(UserRole.CUSTOMER)
  // ParseUUIDPipe: queueId feeds a uuid column directly; a malformed id
  // used to reach Postgres and 500 on "invalid input syntax for type
  // uuid" before the service's own not-found check could run.
  async getQueuePosition(@Param('queueId', ParseUUIDPipe) queueId: string) {
    return this.queuesService.getQueuePosition(queueId);
  }

  @Post(':queueId/checkin')
  @Roles(UserRole.CUSTOMER, UserRole.DOOR_STAFF)
  @HttpCode(200)
  async checkInFromQueue(
    @Param('queueId', ParseUUIDPipe) queueId: string,
    @CurrentUser() user: any,
    @IpAddress() ipAddress: string,
  ) {
    return this.queuesService.checkInFromQueue(queueId, user.id, ipAddress);
  }

  @Post(':queueId/cancel')
  @Roles(UserRole.CUSTOMER)
  @HttpCode(200)
  async cancelQueue(
    @Param('queueId', ParseUUIDPipe) queueId: string,
    @CurrentUser() user: any,
    @IpAddress() ipAddress: string,
  ) {
    await this.queuesService.cancelQueueEntry(queueId, user.id, ipAddress);
    return { success: true };
  }
}