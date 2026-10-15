import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Queue } from '../../shared/entities/queue.entity';
import { AuditService } from '../audit/audit.service';
import { NotificationService } from '../notifications/notifications.service';
import { AuditActionType } from '../../shared/enums';

@Injectable()
export class QueuesService {
  constructor(
    @InjectRepository(Queue)
    private queueRepository: Repository<Queue>,
    private auditService: AuditService,
    private notificationService: NotificationService,
  ) {}

  async joinQueue(venueId: string, userId: string, ipAddress: string): Promise<Queue> {
    // Get current queue length for this venue
    const queueCount = await this.queueRepository.count({
      where: { venueId, status: 'WAITING' },
    });

    const queue = new Queue();
    queue.venueId = venueId;
    queue.userId = userId;
    queue.position = queueCount + 1;
    queue.status = 'WAITING';

    const saved = await this.queueRepository.save(queue);

    await this.auditService.logAction({
      actionType: AuditActionType.QUEUE_JOINED,
      actorId: userId,
      resourceType: 'queue',
      resourceId: saved.id,
      changes: { position: saved.position },
      ipAddress,
    });

    await this.notificationService.sendNotification(
      userId,
      'Joined Queue',
      `You are #${saved.position} in the queue`,
    );

    return saved;
  }

  async getQueuePosition(queueId: string): Promise<any> {
    const queue = await this.queueRepository.findOne({ where: { id: queueId } });

    if (!queue) {
      throw new NotFoundException(`Queue entry ${queueId} not found`);
    }

    return {
      queueId: queue.id,
      position: queue.position,
      status: queue.status,
      createdAt: queue.createdAt,
    };
  }

  async getVenueQueueStatus(venueId: string): Promise<any> {
    const waitingQueue = await this.queueRepository.find({
      where: { venueId, status: 'WAITING' },
      order: { position: 'ASC' },
    });

    const calledQueue = await this.queueRepository.find({
      where: { venueId, status: 'CALLED' },
    });

    return {
      venueId,
      totalWaiting: waitingQueue.length,
      totalCalled: calledQueue.length,
      waitingList: waitingQueue.map((q) => ({
        queueId: q.id,
        position: q.position,
        arrivedAt: q.createdAt,
      })),
    };
  }

  async callNextInQueue(venueId: string, ipAddress: string): Promise<Queue> {
    const nextInQueue = await this.queueRepository.findOne({
      where: { venueId, status: 'WAITING' },
      order: { position: 'ASC' },
    });

    if (!nextInQueue) {
      throw new NotFoundException('No one in queue');
    }

    nextInQueue.status = 'CALLED';
    nextInQueue.calledAt = new Date();

    const updated = await this.queueRepository.save(nextInQueue);

    await this.notificationService.sendNotification(
      nextInQueue.userId,
      'Your Turn!',
      'You have been called. Please proceed to the entrance.',
    );

    await this.auditService.logAction({
      actionType: AuditActionType.QUEUE_CALLED,
      resourceType: 'queue',
      resourceId: updated.id,
      changes: { status: 'CALLED' },
      ipAddress,
    });

    return updated;
  }

  async checkInFromQueue(
    queueId: string,
    userId: string,
    ipAddress: string,
  ): Promise<Queue> {
    const queue = await this.queueRepository.findOne({ where: { id: queueId } });

    if (!queue) {
      throw new NotFoundException(`Queue entry ${queueId} not found`);
    }

    if (queue.userId !== userId) {
      throw new BadRequestException('You cannot check in for another user');
    }

    queue.status = 'CHECKED_IN';
    queue.checkedInAt = new Date();

    const updated = await this.queueRepository.save(queue);

    await this.auditService.logAction({
      actionType: AuditActionType.QUEUE_CHECKED_IN,
      actorId: userId,
      resourceType: 'queue',
      resourceId: updated.id,
      changes: { status: 'CHECKED_IN' },
      ipAddress,
    });

    return updated;
  }

  async cancelQueueEntry(
    queueId: string,
    userId: string,
    ipAddress: string,
  ): Promise<void> {
    const queue = await this.queueRepository.findOne({ where: { id: queueId } });

    if (!queue) {
      throw new NotFoundException(`Queue entry ${queueId} not found`);
    }

    if (queue.userId !== userId) {
      throw new BadRequestException('You cannot cancel another user\'s queue entry');
    }

    queue.status = 'CANCELLED';
    queue.cancelledAt = new Date();

    await this.queueRepository.save(queue);

    // Reorder remaining queue positions
    const remainingQueue = await this.queueRepository.find({
      where: { venueId: queue.venueId, status: 'WAITING' },
      order: { position: 'ASC' },
    });

    for (let i = 0; i < remainingQueue.length; i++) {
      remainingQueue[i].position = i + 1;
    }

    await this.queueRepository.save(remainingQueue);

    await this.auditService.logAction({
      actionType: AuditActionType.QUEUE_CANCELLED,
      actorId: userId,
      resourceType: 'queue',
      resourceId: queueId,
      changes: { status: 'CANCELLED' },
      ipAddress,
    });
  }
}