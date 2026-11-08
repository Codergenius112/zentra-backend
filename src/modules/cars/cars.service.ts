import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Booking } from '../../shared/entities/booking.entity';
import { PlatformSettings } from '../../shared/entities/platform-settings.entity';
import { BookingType, BookingStatus, PaymentStatus, AuditActionType, CommissionPayer } from '../../shared/enums';
import { AuditService } from '../audit/audit.service';
import { BusinessContextService } from '../../shared/services/business-context.service';

interface CreateCarRentalDto {
  carId: string;
  pickupDate: string;
  returnDate: string;
  price: number;
  driverLicense: string;
  pickupLocation: string;
}

@Injectable()
export class CarsService {
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

  async rentCar(
    userId: string,
    createCarRentalDto: CreateCarRentalDto,
    ipAddress: string,
  ): Promise<Booking> {
    // Check availability
    const existingBooking = await this.bookingRepository.findOne({
      where: {
        resourceId: createCarRentalDto.carId,
        status: BookingStatus.CONFIRMED,
      },
    });

    if (existingBooking) {
      throw new BadRequestException('Car not available for selected dates');
    }

    // Get platform settings
    const platformSettings = await this.getPlatformSettings();
    const commissionRate = Number(platformSettings.commissionRate) || 0.03;
    const serviceCharge = Number(platformSettings.serviceCharge) || 400;
    const commissionPayer = platformSettings.commissionPayer || CommissionPayer.USER;
    const basePrice = createCarRentalDto.price;
    const commission = basePrice * commissionRate;
    const cautionFee = Math.ceil(basePrice * 0.2); // 20% caution fee

    const booking = new Booking();
    booking.bookingType = BookingType.CAR;
    booking.userId = userId;
    booking.resourceId = createCarRentalDto.carId;
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
      BookingType.CAR,
      createCarRentalDto.carId,
    );
    booking.metadata = {
      pickupDate: createCarRentalDto.pickupDate,
      returnDate: createCarRentalDto.returnDate,
      driverLicense: createCarRentalDto.driverLicense,
      pickupLocation: createCarRentalDto.pickupLocation,
      cautionFee,
      commissionPayer,
      commissionRate,
    };

    const saved = await this.bookingRepository.save(booking);

    await this.auditService.logAction({
      actionType: AuditActionType.BOOKING_CREATED,
      actorId: userId,
      resourceType: 'car',
      resourceId: saved.id,
      changes: { pickupDate: createCarRentalDto.pickupDate, price: createCarRentalDto.price },
      ipAddress,
    });

    return saved;
  }

  async getCarRental(rentalId: string, userId: string): Promise<Booking> {
    // ← FIXED — same missing-userId bug found and fixed in tickets/tables/
    // bookings/orders/apartments: any customer could view any OTHER
    // customer's car rental by guessing the id.
    const booking = await this.bookingRepository.findOne({
      where: { id: rentalId, userId, bookingType: BookingType.CAR },
    });

    if (!booking) {
      throw new NotFoundException('Car rental not found');
    }

    return booking;
  }

  async getUserCarRentals(userId: string, limit = 20, offset = 0) {
    return this.bookingRepository.findAndCount({
      where: { userId, bookingType: BookingType.CAR },
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });
  }
}