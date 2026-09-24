import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { ApartmentListing } from '../../shared/entities/apartment-listing.entity';
import {
  IsString, IsOptional, IsNumber, Min, IsArray, ArrayMinSize, IsBoolean,
} from 'class-validator';
import { BusinessContextService } from '../../shared/services/business-context.service'; // ← NEW (multi-tenancy)

// ← NEW: listings returned to callers carry the owning business's display
// name alongside the raw businessId, resolved via attachBusinessNames below.
export type ApartmentListingWithBusiness = ApartmentListing & { businessName?: string };

// Was previously a plain interface, which NestJS's ValidationPipe cannot
// validate at all (interfaces are erased at runtime) — the controller took
// `@Body() dto: any`, so apartment listing creation had zero field
// validation. Converted to a real class-validator DTO.
export class CreateApartmentListingDto {
  @IsString() name: string;
  @IsString() description: string;
  @IsString() address: string;
  @IsString() city: string;
  @IsString() state: string;
  @IsNumber() @Min(0) pricePerNight: number;
  @IsNumber() @Min(0) bedrooms: number;
  @IsNumber() @Min(0) bathrooms: number;
  @IsNumber() @Min(1) maxGuests: number;
  @IsOptional() @IsNumber() @Min(0) cautionFee?: number;
  @IsOptional() @IsBoolean() cautionFeeRefundable?: boolean;
  @IsOptional() @IsString() houseRules?: string;
  @IsOptional() @IsArray() amenities?: string[];
  @IsArray() @ArrayMinSize(1, { message: 'At least one image is required' }) images: string[];
  @IsOptional() @IsString() managedBy?: string | null;
}

export class UpdateApartmentListingDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() state?: string;
  @IsOptional() @IsNumber() @Min(0) pricePerNight?: number;
  @IsOptional() @IsNumber() @Min(0) bedrooms?: number;
  @IsOptional() @IsNumber() @Min(0) bathrooms?: number;
  @IsOptional() @IsNumber() @Min(1) maxGuests?: number;
  @IsOptional() @IsNumber() @Min(0) cautionFee?: number;
  @IsOptional() @IsBoolean() cautionFeeRefundable?: boolean;
  @IsOptional() @IsString() houseRules?: string;
  @IsOptional() @IsArray() amenities?: string[];
  @IsOptional() @IsArray() images?: string[];
  @IsOptional() @IsString() managedBy?: string | null;
  @IsOptional() isActive?: boolean;
}

export interface GetApartmentListingsQuery {
  city?: string;
  minPrice?: number;
  maxPrice?: number;
  bedrooms?: number;
  limit?: number;
  offset?: number;
  // ← CHANGED (multi-tenancy): businessIds replaces the old single ownerId.
  // undefined = no restriction (public catalog / super admin). [] =
  // restrict to nothing. Otherwise scope to those specific business(es) —
  // this is what lets one owner's several businesses stay isolated from
  // each other, not just isolated from other owners.
  businessIds?: string[];
  activeOnly?: boolean;
}

@Injectable()
export class ApartmentListingsService {
  constructor(
    @InjectRepository(ApartmentListing)
    private listingRepository: Repository<ApartmentListing>,
    private readonly businessContext: BusinessContextService, // ← NEW (multi-tenancy)
    @InjectDataSource() private readonly dataSource: DataSource, // ← NEW: for businessName lookups
  ) {}

  /**
   * Resolves each listing's businessId → business name in a single batched
   * query and attaches it as `businessName`. Listings with no businessId
   * (legacy/unassigned) simply get businessName: undefined.
   */
  private async attachBusinessNames(listings: ApartmentListing[]): Promise<ApartmentListingWithBusiness[]> {
    const businessIds = Array.from(
      new Set(listings.map((l) => (l as any).businessId).filter((id): id is string => !!id)),
    );
    if (businessIds.length === 0) return listings as ApartmentListingWithBusiness[];

    const rows = await this.dataSource.query(
      `SELECT id, name FROM businesses WHERE id = ANY($1)`,
      [businessIds],
    );
    const nameById = new Map<string, string>(rows.map((r: any) => [r.id, r.name]));

    return listings.map((l) => ({
      ...l,
      businessName: (l as any).businessId ? nameById.get((l as any).businessId) : undefined,
    }));
  }

  /**
   * GET /apartments/listings
   * Public: all active listings. Staff (businessIds provided): only their
   * own business(es)' listings, active or not.
   */
  async getListings(query: GetApartmentListingsQuery): Promise<{ listings: ApartmentListingWithBusiness[]; total: number }> {
    if (query.businessIds && query.businessIds.length === 0) return { listings: [], total: 0 };

    const qb = this.listingRepository.createQueryBuilder('listing');
    if (query.activeOnly !== false) {
      qb.where('listing.isActive = :isActive', { isActive: true });
    } else {
      qb.where('1=1');
    }
    if (query.businessIds) {
      qb.andWhere('listing."businessId" IN (:...businessIds)', { businessIds: query.businessIds });
    }

    if (query.city) {
      qb.andWhere('LOWER(listing.city) LIKE :city', { city: `%${query.city.toLowerCase()}%` });
    }
    if (query.minPrice !== undefined) {
      qb.andWhere('listing.pricePerNight >= :minPrice', { minPrice: query.minPrice });
    }
    if (query.maxPrice !== undefined) {
      qb.andWhere('listing.pricePerNight <= :maxPrice', { maxPrice: query.maxPrice });
    }
    if (query.bedrooms !== undefined) {
      qb.andWhere('listing.bedrooms >= :bedrooms', { bedrooms: query.bedrooms });
    }

    qb.orderBy('listing.createdAt', 'DESC')
      .take(query.limit || 20)
      .skip(query.offset || 0);

    const [listings, total] = await qb.getManyAndCount();
    return { listings: await this.attachBusinessNames(listings), total };
  }

  /**
   * GET /apartments/listings/:id
   * Returns a single listing by ID.
   */
  async getListing(id: string, businessIds?: string[]): Promise<ApartmentListingWithBusiness> {
    const listing = await this.listingRepository.findOne({
      where: { id, isActive: true },
    });
    if (!listing) {
      throw new NotFoundException(`Apartment listing ${id} not found`);
    }
    if (businessIds !== undefined && (!businessIds.length || !businessIds.includes((listing as any).businessId))) {
      throw new NotFoundException(`Apartment listing ${id} not found`);
    }
    const [withBusiness] = await this.attachBusinessNames([listing]);
    return withBusiness;
  }

  /**
   * POST /apartments/listings  (admin/manager only)
   */
  async createListing(dto: CreateApartmentListingDto & { businessId?: string | null }): Promise<ApartmentListing> {
    const listing = this.listingRepository.create({
      ...dto,
      amenities: dto.amenities || [],
      images: dto.images || [],
      isActive: true,
    });
    return this.listingRepository.save(listing);
  }

  /**
   * PATCH /apartments/listings/:id  (admin/manager only)
   */
  async updateListing(id: string, dto: UpdateApartmentListingDto, businessIds?: string[]): Promise<ApartmentListing> {
    const listing = await this.listingRepository.findOne({ where: { id } });
    if (!listing) {
      throw new NotFoundException(`Apartment listing ${id} not found`);
    }
    if (businessIds !== undefined && (!businessIds.length || !businessIds.includes((listing as any).businessId))) {
      throw new NotFoundException(`Apartment listing ${id} not found`);
    }
    // ← NEW (multi-tenancy) — close the suspension-freeze gap.
    await this.businessContext.assertBusinessActive((listing as any).businessId);
    Object.assign(listing, dto);
    return this.listingRepository.save(listing);
  }

  /**
   * DELETE /apartments/listings/:id  (admin only) — soft delete via isActive flag
   */
  async deactivateListing(id: string, businessIds?: string[]): Promise<{ success: boolean }> {
    const listing = await this.listingRepository.findOne({ where: { id } });
    if (!listing) {
      throw new NotFoundException(`Apartment listing ${id} not found`);
    }
    if (businessIds !== undefined && (!businessIds.length || !businessIds.includes((listing as any).businessId))) {
      throw new NotFoundException(`Apartment listing ${id} not found`);
    }
    await this.businessContext.assertBusinessActive((listing as any).businessId);
    listing.isActive = false;
    await this.listingRepository.save(listing);
    return { success: true };
  }
}