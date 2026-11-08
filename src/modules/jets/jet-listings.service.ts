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

    // Auto-seed initial fleet if database is empty so app works immediately
    if (total === 0 && (!filters.businessIds || filters.businessIds.length > 0)) {
      const seeded = await this.seedInitialFleet(filters.businessIds?.[0]);
      if (seeded.length > 0) {
        return { listings: seeded, total: seeded.length };
      }
    }

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

  private async seedInitialFleet(businessId?: string): Promise<JetListing[]> {
    const count = await this.jetRepo.count();
    if (count > 0) return [];

    const fleet = [
      {
        name: 'Gulfstream G650ER',
        model: 'G650ER',
        manufacturer: 'Gulfstream Aerospace',
        category: 'HEAVY_JET',
        tailNumber: '5N-ZEN',
        capacity: 14,
        rangeNauticalMiles: 7500,
        cruisingSpeedKnots: 516,
        pricePerHour: 4800000,
        cautionFee: 500000,
        cautionFeeRefundable: true,
        baseAirport: 'LOS - Murtala Muhammed International',
        city: 'Lagos',
        country: 'Nigeria',
        description: 'The pinnacle of luxury intercontinental private aviation. Ultra-long range with custom cabin layout, private bedroom, full galley and ultra-quiet cabin technology.',
        features: ['High-Speed Ka-Band Wi-Fi', 'Private Stateroom / Bedroom', 'Full Convection Galley', 'Enclosed Aft Lavatory with Shower', 'Flight Attendant Onboard'],
        amenities: ['Dom Pérignon Welcome Service', 'Fine China & Crystal Glassware', 'Loro Piana Cashmere Blankets', 'Rockwell Collins Cabin Management'],
        images: [
          'https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?auto=format&fit=crop&w=1200&q=80',
          'https://images.unsplash.com/photo-1583416750470-965b2707b355?auto=format&fit=crop&w=1200&q=80',
        ],
        businessId: businessId || null,
        isActive: true,
        isDeleted: false,
      },
      {
        name: 'Bombardier Challenger 350',
        model: 'Challenger 350',
        manufacturer: 'Bombardier',
        category: 'MIDSIZE_JET',
        tailNumber: '5N-ABV',
        capacity: 9,
        rangeNauticalMiles: 3200,
        cruisingSpeedKnots: 470,
        pricePerHour: 3200000,
        cautionFee: 350000,
        cautionFeeRefundable: true,
        baseAirport: 'ABV - Nnamdi Azikiwe International',
        city: 'Abuja',
        country: 'Nigeria',
        description: 'Best-selling super midsize jet in the world. Exceptional comfort, smooth ride, flat floor cabin design, and direct non-stop access across West Africa and Europe.',
        features: ['Satellite Wi-Fi', 'Flat Floor Cabin', 'Dual Club Seating', 'In-Flight Accessible Baggage Bay'],
        amenities: ['Premium Catering', 'Espresso Machine', 'Airshow 3D Flight Tracker'],
        images: [
          'https://images.unsplash.com/photo-1569154941061-e231b4725ef1?auto=format&fit=crop&w=1200&q=80',
          'https://images.unsplash.com/photo-1519074069444-1ba4e320d3e2?auto=format&fit=crop&w=1200&q=80',
        ],
        businessId: businessId || null,
        isActive: true,
        isDeleted: false,
      },
      {
        name: 'Bell 429 GlobalRanger',
        model: 'Bell 429',
        manufacturer: 'Bell Helicopter',
        category: 'HELICOPTER',
        tailNumber: '5N-HLI',
        capacity: 6,
        rangeNauticalMiles: 411,
        cruisingSpeedKnots: 155,
        pricePerHour: 1800000,
        cautionFee: 200000,
        cautionFeeRefundable: true,
        baseAirport: 'Epe Helipad / Victoria Island Heliport',
        city: 'Lagos',
        country: 'Nigeria',
        description: 'Twin-engine luxury executive helicopter designed for swift VIP transfers between Victoria Island, Ikoyi, Lekki, and Murtala Muhammed International Airport.',
        features: ['Twin Turbine Engines', 'Bose A20 Noise-Cancelling Headsets', 'Panoramic Windows', 'Air Conditioning'],
        amenities: ['Leather Executive Club Seating', 'VIP Ground Meet & Greet'],
        images: [
          'https://images.unsplash.com/photo-1508614589041-895b88991e3e?auto=format&fit=crop&w=1200&q=80',
          'https://images.unsplash.com/photo-1534447677768-be436bb09401?auto=format&fit=crop&w=1200&q=80',
        ],
        businessId: businessId || null,
        isActive: true,
        isDeleted: false,
      },
      {
        name: 'Embraer Phenom 300E',
        model: 'Phenom 300E',
        manufacturer: 'Embraer',
        category: 'LIGHT_JET',
        tailNumber: '5N-PHN',
        capacity: 7,
        rangeNauticalMiles: 2010,
        cruisingSpeedKnots: 464,
        pricePerHour: 2400000,
        cautionFee: 250000,
        cautionFeeRefundable: true,
        baseAirport: 'LOS - Murtala Muhammed International',
        city: 'Lagos',
        country: 'Nigeria',
        description: 'The fastest and longest-range single-pilot certified light jet. Unmatched performance, low carbon footprint, and high-altitude comfort.',
        features: ['Gogo Inflight Internet', 'Bespoke Bossa Nova Interior', 'Full Refreshment Center'],
        amenities: ['Executive Reclining Seats', 'Quiet Cabin Acoustic Treatment'],
        images: [
          'https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?auto=format&fit=crop&w=1200&q=80',
        ],
        businessId: businessId || null,
        isActive: true,
        isDeleted: false,
      },
    ];

    const entities = this.jetRepo.create(fleet as any);
    return this.jetRepo.save(entities);
  }
}
