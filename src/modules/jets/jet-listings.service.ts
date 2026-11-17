import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { JetListing } from '../../shared/entities/jet-listing.entity';
import {
  IsString, IsNumber, IsOptional, IsBoolean, IsArray, Min, Max,
} from 'class-validator';

export class CreateJetListingDto {
  @IsString() name: string;
  @IsString() model: string;
  @IsString() manufacturer: string;
  @IsOptional() @IsString() category?: string;
  @IsString() tailNumber: string;
  @IsNumber() @Min(1) @Max(100) capacity: number;
  @IsOptional() @IsNumber() rangeNauticalMiles?: number;
  @IsOptional() @IsNumber() cruisingSpeedKnots?: number;
  @IsNumber() @Min(0) pricePerHour: number;
  @IsOptional() @IsNumber() @Min(0) cautionFee?: number;
  @IsOptional() @IsBoolean() cautionFeeRefundable?: boolean;
  @IsString() baseAirport: string;
  @IsString() city: string;
  @IsOptional() @IsString() country?: string;
  @IsString() description: string;
  @IsOptional() @IsArray() features?: string[];
  @IsOptional() @IsArray() amenities?: string[];
  @IsArray() images: string[];
  @IsOptional() @IsArray() unavailableDates?: string[];
  @IsOptional() @IsString() managedBy?: string | null;
  @IsOptional() @IsString() businessId?: string | null;
}

export class UpdateJetListingDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() model?: string;
  @IsOptional() @IsString() manufacturer?: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsString() tailNumber?: string;
  @IsOptional() @IsNumber() @Min(1) @Max(100) capacity?: number;
  @IsOptional() @IsNumber() rangeNauticalMiles?: number;
  @IsOptional() @IsNumber() cruisingSpeedKnots?: number;
  @IsOptional() @IsNumber() @Min(0) pricePerHour?: number;
  @IsOptional() @IsNumber() @Min(0) cautionFee?: number;
  @IsOptional() @IsBoolean() cautionFeeRefundable?: boolean;
  @IsOptional() @IsString() baseAirport?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() country?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsArray() features?: string[];
  @IsOptional() @IsArray() amenities?: string[];
  @IsOptional() @IsArray() images?: string[];
  @IsOptional() @IsArray() unavailableDates?: string[];
  @IsOptional() @IsBoolean() isActive?: boolean;
}

@Injectable()
export class JetListingsService {
  constructor(
    @InjectRepository(JetListing)
    private readonly jetRepo: Repository<JetListing>,
  ) {}

  async getListings(filters: {
    category?: string;
    city?: string;
    minCapacity?: number;
    maxPrice?: number;
    limit?: number;
    offset?: number;
    businessIds?: string[];
    activeOnly?: boolean;
  }) {
    // If staff caller has an empty business list, they have access to no tenant
    if (filters.businessIds && filters.businessIds.length === 0) {
      return { listings: [], total: 0 };
    }

    const qb = this.jetRepo.createQueryBuilder('j')
      .where('j.isDeleted = false');

    if (filters.activeOnly !== false) {
      qb.andWhere('j.isActive = true');
    }

    if (filters.category && filters.category !== 'ALL') {
      qb.andWhere('j.category ILIKE :cat', { cat: filters.category });
    }

    if (filters.city) {
      qb.andWhere('j.city ILIKE :city', { city: `%${filters.city}%` });
    }

    if (filters.minCapacity) {
      qb.andWhere('j.capacity >= :cap', { cap: filters.minCapacity });
    }

    if (filters.maxPrice) {
      qb.andWhere('j.pricePerHour <= :maxPrice', { maxPrice: filters.maxPrice });
    }

    if (filters.businessIds) {
      qb.andWhere('j."businessId" IN (:...bids)', { bids: filters.businessIds });
    }

    qb.orderBy('j.createdAt', 'DESC')
      .take(filters.limit || 20)
      .skip(filters.offset || 0);

    const [listings, total] = await qb.getManyAndCount();
    return { listings, total };
  }

  async getListing(id: string, businessIds?: string[]) {
    const listing = await this.jetRepo.findOne({
      where: { id, isDeleted: false },
    });
    if (!listing) throw new NotFoundException('Jet listing not found');

    if (businessIds !== undefined) {
      if (!listing.businessId || !businessIds.includes(listing.businessId)) {
        throw new ForbiddenException('You do not have access to this jet listing');
      }
    }

    return listing;
  }

  async createListing(data: CreateJetListingDto & { managedBy?: string | null; businessId?: string | null }) {
    const listing = this.jetRepo.create({
      ...data,
      category: data.category || 'MIDSIZE_JET',
      cautionFee: data.cautionFee ?? Math.round(Number(data.pricePerHour) * 0.15),
      cautionFeeRefundable: data.cautionFeeRefundable ?? true,
      features: data.features || ['Wi-Fi', 'Enclosed Lavatory', 'Flight Attendant'],
      amenities: data.amenities || ['Leather Club Seating', 'Champagne Bar', 'Noise-Cancelling Headsets'],
      images: data.images || [],
      isActive: true,
      isDeleted: false,
    });
    return this.jetRepo.save(listing);
  }

  async updateListing(id: string, dto: UpdateJetListingDto, businessIds?: string[]) {
    const listing = await this.getListing(id, businessIds);
    Object.assign(listing, dto);
    return this.jetRepo.save(listing);
  }

  async deactivateListing(id: string, businessIds?: string[]) {
    const listing = await this.getListing(id, businessIds);
    listing.isActive = false;
    return this.jetRepo.save(listing);
  }

  async deleteListing(id: string, businessIds?: string[]) {
    const listing = await this.getListing(id, businessIds);
    listing.isDeleted = true;
    listing.isActive = false;
    return this.jetRepo.save(listing);
  }

}
