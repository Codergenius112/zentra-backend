import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Booking } from '../../shared/entities/booking.entity';
import { JetListing } from '../../shared/entities/jet-listing.entity';
import { PlatformSettings } from '../../shared/entities/platform-settings.entity';
import {
  BookingType, BookingStatus, PaymentStatus, AuditActionType, CommissionPayer,
} from '../../shared/enums';
import { AuditService } from '../audit/audit.service';
import { BusinessContextService } from '../../shared/services/business-context.service';

export interface CreateJetBookingDto {
  jetId: string;
  departureAirport: string;
  arrivalAirport: string;
  departureDate: string;
  departureTime?: string;
  returnDate?: string;
  tripType?: 'ONE_WAY' | 'ROUND_TRIP';
  passengerCount: number;
  price: number;
  specialRequests?: string;
  contactName?: string;
  contactPhone?: string;
}

@Injectable()
export class JetsService {
  private readonly SINGLETON_ID = '00000000-0000-0000-0000-000000000001';

  constructor(
    @InjectRepository(Booking)
    private bookingRepository: Repository<Booking>,
    @InjectRepository(JetListing)
    private jetListingRepository: Repository<JetListing>,
    @InjectRepository(PlatformSettings)
    private platformSettingsRepository: Repository<PlatformSettings>,
    private auditService: AuditService,
    private businessContext: BusinessContextService,
  ) {}

  private async getPlatformSettings(): Promise<PlatformSettings> {
    let settings = await this.platformSettingsRepository.findOne({ where: { id: this.SINGLETON_ID } });
    if (!settings) {
      settings = this.platformSettingsRepository.create({ id: this.SINGLETON_ID });
      await this.platformSettingsRepository.save(settings);
    }
    return settings;
  }

  async bookJet(
    userId: string,
    dto: CreateJetBookingDto,
    ipAddress: string,
  ): Promise<Booking> {
    const jet = await this.jetListingRepository.findOne({
      where: { id: dto.jetId, isDeleted: false, isActive: true },
    });
    if (!jet) {
      throw new NotFoundException('Selected aircraft is not available or does not exist');
    }

    if (dto.passengerCount > jet.capacity) {
      throw new BadRequestException(`Maximum passenger capacity for this aircraft is ${jet.capacity}`);
    }

    // Check date availability
    if (jet.unavailableDates && jet.unavailableDates.includes(dto.departureDate)) {
      throw new BadRequestException('Aircraft is unavailable on the selected departure date');
    }

    // Check platform settings for commission & fees
    const platformSettings = await this.getPlatformSettings();
    const commissionRate = Number(platformSettings.commissionRate) || 0.03;
    const serviceCharge = Number(platformSettings.serviceCharge) || 400;
    const commissionPayer = platformSettings.commissionPayer || CommissionPayer.USER;
    const basePrice = Number(dto.price) || Number(jet.pricePerHour);
    const commission = basePrice * commissionRate;
    const cautionFee = Number(jet.cautionFee) || Math.ceil(basePrice * 0.15);

    const booking = new Booking();
    booking.bookingType = BookingType.JET;
    booking.userId = userId;
    booking.resourceId = dto.jetId;
    booking.basePrice = basePrice;
    booking.guestCount = dto.passengerCount || 1;
    booking.serviceCharge = serviceCharge;
    booking.platformCommission = commission;

    // Stamping tenant businessId
    booking.businessId = jet.businessId ?? (
      await this.businessContext.resolveBusinessIdForBooking(BookingType.JET, dto.jetId)
    );

    // If USER pays commission: add to total
    if (commissionPayer === CommissionPayer.USER) {
      booking.totalAmount = basePrice + serviceCharge + commission;
    } else {
      booking.totalAmount = basePrice + serviceCharge;
    }

    booking.status = BookingStatus.INITIATED;
    booking.paymentStatus = PaymentStatus.UNPAID;
    booking.metadata = {
      aircraftName: jet.name,
      model: jet.model,
      tailNumber: jet.tailNumber,
      category: jet.category,
      departureAirport: dto.departureAirport,
      arrivalAirport: dto.arrivalAirport,
      departureDate: dto.departureDate,
      departureTime: dto.departureTime || '10:00',
      returnDate: dto.returnDate || null,
      tripType: dto.tripType || (dto.returnDate ? 'ROUND_TRIP' : 'ONE_WAY'),
      passengerCount: dto.passengerCount,
      specialRequests: dto.specialRequests || '',
      contactName: dto.contactName || '',
      contactPhone: dto.contactPhone || '',
      cautionFee,
      cautionFeeRefundable: jet.cautionFeeRefundable,
      commissionPayer,
      commissionRate,
    };

    const saved = await this.bookingRepository.save(booking);

    await this.auditService.logAction({
      actionType: AuditActionType.BOOKING_CREATED,
      actorId: userId,
      resourceType: 'jet',
      resourceId: saved.id,
      changes: {
        departureDate: dto.departureDate,
        route: `${dto.departureAirport} → ${dto.arrivalAirport}`,
        price: basePrice,
      },
      ipAddress,
    });

    return saved;
  }

  async getUserJetBookings(userId: string, limit = 20, offset = 0): Promise<[Booking[], number]> {
    return this.bookingRepository.findAndCount({
      where: {
        userId,
        bookingType: BookingType.JET,
        isDeleted: false,
      },
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
      relations: ['payments'],
    });
  }

  async getJetBooking(bookingId: string, userId: string): Promise<Booking> {
    const booking = await this.bookingRepository.findOne({
      where: { id: bookingId, bookingType: BookingType.JET, isDeleted: false },
      relations: ['payments'],
    });

    if (!booking) throw new NotFoundException('Booking not found');
    if (booking.userId !== userId) {
      throw new BadRequestException('You do not have permission to view this booking');
    }

    return booking;
  }
}
