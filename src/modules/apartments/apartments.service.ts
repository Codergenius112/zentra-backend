import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Booking } from '../../shared/entities/booking.entity';
import { PlatformSettings } from '../../shared/entities/platform-settings.entity';
import { BookingType, BookingStatus, PaymentStatus, AuditActionType, CommissionPayer } from '../../shared/enums';
import { AuditService } from '../audit/audit.service';
import { BusinessContextService } from '../../shared/services/business-context.service';

interface CreateApartmentBookingDto {
  apartmentId: string;
  checkInDate: string;
  checkOutDate: string;
  price: number;
}

@Injectable()
export class ApartmentsService {
  private readonly SINGLETON_ID = '00000000-0000-0000-0000-000000000001';

  constructor(
    @InjectRepository(Booking)
    private bookingRepository: Repository<Booking>,
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

  async bookApartment(
    userId: string,
    createApartmentBookingDto: CreateApartmentBookingDto,
    ipAddress: string,
  ): Promise<Booking> {
    // Check availability
    const existingBooking = await this.bookingRepository.findOne({
      where: {
        resourceId: createApartmentBookingDto.apartmentId,
        status: BookingStatus.CONFIRMED,
      },
    });

    if (existingBooking) {
      throw new BadRequestException('Apartment not available for selected dates');
    }

    // Get platform settings
    const platformSettings = await this.getPlatformSettings();
    const commissionRate = Number(platformSettings.commissionRate) || 0.03;
    const serviceCharge = Number(platformSettings.serviceCharge) || 400;
    const commissionPayer = platformSettings.commissionPayer || CommissionPayer.USER;
    const basePrice = createApartmentBookingDto.price;
    const commission = basePrice * commissionRate;
    const cautionFee = Math.ceil(basePrice * 0.1); // 10% caution fee

    const booking = new Booking();
    booking.bookingType = BookingType.APARTMENT;
    booking.userId = userId;
    booking.resourceId = createApartmentBookingDto.apartmentId;
    booking.basePrice = basePrice;
    booking.guestCount = 1;
    booking.serviceCharge = serviceCharge;
    booking.platformCommission = commission;

    // If USER pays commission: add to total
    if (commissionPayer === CommissionPayer.USER) {
      booking.totalAmount = basePrice + serviceCharge + commission;
    } else {
      booking.totalAmount = basePrice + serviceCharge;
    }

    booking.status = BookingStatus.INITIATED;
    booking.paymentStatus = PaymentStatus.UNPAID;
    booking.businessId = await this.businessContext.resolveBusinessIdForBooking(
      BookingType.APARTMENT,
      createApartmentBookingDto.apartmentId,
    );
    booking.metadata = {
      checkInDate: createApartmentBookingDto.checkInDate,
      checkOutDate: createApartmentBookingDto.checkOutDate,
      cautionFee,
      commissionPayer,
      commissionRate,
    };

    const saved = await this.bookingRepository.save(booking);

    await this.auditService.logAction({
      actionType: AuditActionType.BOOKING_CREATED,
      actorId: userId,
      resourceType: 'apartment',
      resourceId: saved.id,
      changes: { checkIn: createApartmentBookingDto.checkInDate, price: createApartmentBookingDto.price },
      ipAddress,
    });

    return saved;
  }

  async getApartmentBooking(bookingId: string, userId: string): Promise<Booking> {
    // ← FIXED — same missing-userId bug found and fixed in tickets/tables/
    // bookings/orders: any customer could view any OTHER customer's
    // apartment booking by guessing the id.
    const booking = await this.bookingRepository.findOne({
      where: { id: bookingId, userId, bookingType: BookingType.APARTMENT },
    });

    if (!booking) {
      throw new NotFoundException('Apartment booking not found');
    }

    return booking;
  }

  async getUserApartmentBookings(userId: string, limit = 20, offset = 0) {
    return this.bookingRepository.findAndCount({
      where: { userId, bookingType: BookingType.APARTMENT },
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });
  }
}