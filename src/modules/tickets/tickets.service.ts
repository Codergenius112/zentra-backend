import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Booking } from '../../shared/entities/booking.entity';
import { PlatformSettings } from '../../shared/entities/platform-settings.entity';
import { BookingType, BookingStatus, PaymentStatus, AuditActionType, CommissionPayer, UserRole } from '../../shared/enums';
import { AuditService } from '../audit/audit.service';
import { BookingService } from '../bookings/bookings.service';

interface CreateTicketDto {
  eventId: string;
  quantity: number;
  // basePrice for `quantity` tickets, before service charge. Field name
  // 'price' matches mobile api.ts (ticketsAPI.createTicket) and the same
  // convention used by table bookings (CreateTableBookingDto.price) — the
  // previous 'totalPrice' name here was never actually sent by the client,
  // so every ticket booking silently priced at basePrice: 0.
  price: number;
}

@Injectable()
export class TicketsService {
  private readonly SINGLETON_ID = '00000000-0000-0000-0000-000000000001';

  constructor(
    @InjectRepository(Booking)
    private bookingRepository: Repository<Booking>,
    @InjectRepository(PlatformSettings)
    private platformSettingsRepository: Repository<PlatformSettings>,
    private auditService: AuditService,
    private bookingService: BookingService,
  ) {}

  private async getPlatformSettings(): Promise<PlatformSettings> {
    let settings = await this.platformSettingsRepository.findOne({ where: { id: this.SINGLETON_ID } });
    if (!settings) {
      settings = this.platformSettingsRepository.create({ id: this.SINGLETON_ID });
      await this.platformSettingsRepository.save(settings);
    }
    return settings;
  }

  // ── POST /tickets ───────────────────────────────────────────────────────────
  async createTicket(userId: string, dto: CreateTicketDto, ipAddress: string): Promise<Booking> {
    const platformSettings = await this.getPlatformSettings();
    const commissionRate = Number(platformSettings.commissionRate) || 0.03;
    const serviceCharge = Number(platformSettings.serviceCharge) || 400;
    const commissionPayer = platformSettings.commissionPayer || CommissionPayer.USER;

    const basePrice = Number(dto.price ?? 0);
    const commission = basePrice * commissionRate;

    const booking = this.bookingRepository.create({
      bookingType: BookingType.TICKET,
      userId,
      resourceId: dto.eventId,
      guestCount: dto.quantity ?? 1,
      basePrice,
      serviceCharge,
      platformCommission: commission,
      totalAmount: commissionPayer === CommissionPayer.USER
        ? basePrice + serviceCharge + commission
        : basePrice + serviceCharge,
      status: BookingStatus.INITIATED,
      paymentStatus: PaymentStatus.UNPAID,
      metadata: {
        eventId: dto.eventId,
        commissionPayer,
        commissionRate,
      },
    });

    const saved = await this.bookingRepository.save(booking);

    await this.auditService.logAction({
      actionType: AuditActionType.BOOKING_CREATED,
      actorId: userId,
      resourceType: 'ticket',
      resourceId: saved.id,
      changes: { quantity: dto.quantity, price: dto.price },
      ipAddress,
    });

    return saved;
  }

  // ── GET /tickets ───────────────────────────────────────────────────────────
  async getUserTickets(userId: string, limit = 20, offset = 0) {
    return this.bookingRepository.findAndCount({
      where: { userId, bookingType: BookingType.TICKET },
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });
  }

  // ── GET /tickets/:id ───────────────────────────────────────────────────────
  async getTicket(ticketId: string, userId: string): Promise<Booking> {
    // ← FIXED — previously omitted userId entirely, meaning any
    // authenticated customer could view any OTHER customer's ticket
    // (guest name, event details, payment status) just by guessing or
    // enumerating ticket ids. Not a multi-tenancy issue specifically —
    // a pre-existing customer-to-customer privacy leak found while
    // reviewing this module. cancelTicket (below) already scoped
    // correctly; this brings getTicket in line with it.
    const ticket = await this.bookingRepository.findOne({
      where: { id: ticketId, userId, bookingType: BookingType.TICKET },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
    return ticket;
  }

  // ── PATCH /tickets/:id/cancel ─────────────────────────────────────────────
  async cancelTicket(ticketId: string, userId: string, ipAddress: string): Promise<Booking> {
    const ticket = await this.bookingRepository.findOne({
      where: { id: ticketId, userId, bookingType: BookingType.TICKET },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');

    ticket.status = BookingStatus.CANCELLED;
    ticket.cancelledAt = new Date();
    ticket.metadata = {
      ...(ticket.metadata ?? {}),
      cancelledByUser: true,
      ipAddress,
    };

    return this.bookingRepository.save(ticket);
  }

  // ── POST /tickets/scan ────────────────────────────────────────────────────
  // Door-staff / admin ticket check-in from a scanned (or pasted) QR payload.
  // The admin Tickets page called this route before it existed — every
  // manual/paste check-in 404'd. (The camera Scanner page uses
  // PATCH /admin/bookings/:id/status instead, which was never broken.)
  //
  // This is deliberately a thin resolver on top of
  // BookingService.updateBookingStatus rather than a third check-in
  // implementation: that method already enforces the state machine, the
  // suspended-business freeze, and the tenant-scoping rules, so a scan can
  // never be more permissive than the two existing check-in routes.
  async scanTicket(
    qrCodeData: string,
    actorId: string,
    actorRole: UserRole,
    ipAddress: string,
    businessIds?: string[],
  ): Promise<Booking> {
    const raw = (qrCodeData ?? '').trim();
    const notFound = () =>
      new NotFoundException('Invalid ticket — no matching ticket found for this QR code');

    if (!raw) throw notFound();

    // Only ever query by id when the value is a well-formed UUID — passing
    // arbitrary scanned text to a uuid column makes Postgres throw, which
    // surfaces as a 500 instead of a clean "invalid ticket".
    const bookingId = this.extractBookingId(raw);
    let ticket: Booking | null = null;
    if (bookingId) {
      ticket = await this.bookingRepository.findOne({
        where: { id: bookingId, bookingType: BookingType.TICKET },
      });
    }
    if (!ticket) {
      // Fall back to the stored QR payload string (booking.qrCodeData is the
      // exact JSON the emailed QR image encodes).
      ticket = await this.bookingRepository.findOne({
        where: { qrCodeData: raw, bookingType: BookingType.TICKET },
      });
    }
    if (!ticket) throw notFound();

    // Tenant scoping BEFORE any status-specific message, so staff from one
    // business can't probe another business's ticket state. Same rule (and
    // same indistinguishable "not found" answer) as updateBookingStatus.
    if (actorRole !== UserRole.SUPER_ADMIN && businessIds !== undefined) {
      const ticketBusinessId = (ticket as any).businessId;
      if (!businessIds.length || !ticketBusinessId || !businessIds.includes(ticketBusinessId)) {
        throw notFound();
      }
    }

    // Door-staff-friendly messages. The state machine would also reject
    // these, but with "Cannot transition from X to Y", which isn't
    // something to show someone standing at a door with a queue behind them.
    if (ticket.status === BookingStatus.CHECKED_IN) {
      throw new BadRequestException('Ticket already checked in');
    }
    if (ticket.status !== BookingStatus.CONFIRMED) {
      throw new BadRequestException(`Ticket is not valid for entry (status: ${ticket.status})`);
    }

    return this.bookingService.updateBookingStatus(
      ticket.id,
      BookingStatus.CHECKED_IN,
      actorId,
      ipAddress,
      actorRole,
      businessIds,
    );
  }

  // The emailed QR encodes JSON like { bookingId, eventId, userId, ... };
  // the admin Tickets page may also hand us just the bare bookingId.
  private extractBookingId(raw: string): string | null {
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (UUID.test(raw)) return raw;
    try {
      const parsed = JSON.parse(raw);
      const candidate = parsed?.bookingId;
      if (typeof candidate === 'string' && UUID.test(candidate.trim())) return candidate.trim();
    } catch {
      // not JSON — fall through to the stored-payload lookup
    }
    return null;
  }
}