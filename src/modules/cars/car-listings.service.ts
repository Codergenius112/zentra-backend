import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { CarListing } from '../../shared/entities/car-listing.entity';
import { BusinessContextService } from '../../shared/services/business-context.service'; // ← NEW (multi-tenancy)
import {
  IsString, IsOptional, IsNumber, Min, IsArray, ArrayMinSize, IsBoolean,
} from 'class-validator';

// ← NEW: listings returned to callers carry the owning business's display
// name alongside the raw businessId, resolved via attachBusinessNames below.
export type CarListingWithBusiness = CarListing & { businessName?: string };

// Was previously a plain interface, which NestJS's ValidationPipe cannot
// validate at all (interfaces are erased at runtime) — the controller took
// `@Body() dto: any`, so car listing creation had zero field validation.
// Converted to a real class-validator DTO.
export class CreateCarListingDto {
  @IsString() make: string;
  @IsString() model: string;
  @IsNumber() year: number;
  @IsString() color: string;
  @IsString() plateNumber: string;
  @IsString() transmission: string;
  @IsString() category: string;
  @IsNumber() @Min(1) seats: number;
  @IsNumber() @Min(0) pricePerDay: number;
  @IsOptional() @IsNumber() @Min(0) cautionFee?: number;
  @IsOptional() @IsBoolean() cautionFeeRefundable?: boolean;
  @IsString() description: string;
  @IsOptional() @IsArray() features?: string[];
  @IsArray() @ArrayMinSize(1, { message: 'At least one image is required' }) images: string[];
  @IsString() city: string;
  @IsString() state: string;
  @IsOptional() @IsBoolean() withDriver?: boolean;
  @IsOptional() @IsString() managedBy?: string | null;
}

export class UpdateCarListingDto {
  @IsOptional() @IsString() make?: string;
  @IsOptional() @IsString() model?: string;
  @IsOptional() @IsNumber() year?: number;
  @IsOptional() @IsString() color?: string;
  @IsOptional() @IsString() plateNumber?: string;
  @IsOptional() @IsString() transmission?: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsNumber() @Min(1) seats?: number;
  @IsOptional() @IsNumber() @Min(0) pricePerDay?: number;
  @IsOptional() @IsNumber() @Min(0) cautionFee?: number;
  @IsOptional() @IsBoolean() cautionFeeRefundable?: boolean;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsArray() features?: string[];
  @IsOptional() @IsArray() images?: string[];
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() state?: string;
  @IsOptional() @IsBoolean() withDriver?: boolean;
  @IsOptional() @IsString() managedBy?: string | null;
  @IsOptional() isActive?: boolean;
}

export interface GetCarListingsQuery {
  city?: string;
  minPrice?: number;
  maxPrice?: number;
  transmission?: string;
  category?: string;
  withDriver?: boolean;
  limit?: number;
  offset?: number;
  // ← CHANGED (multi-tenancy): businessIds replaces the old single ownerId.
  // undefined = no restriction (public catalog / super admin). [] =
  // restrict to nothing. Otherwise scope to those specific business(es).
  businessIds?: string[];
  activeOnly?: boolean;
}

@Injectable()
export class CarListingsService {
  constructor(
    @InjectRepository(CarListing)
    private listingRepository: Repository<CarListing>,
    private readonly businessContext: BusinessContextService, // ← NEW (multi-tenancy)
    @InjectDataSource() private readonly dataSource: DataSource, // ← NEW: for businessName lookups
  ) {}

  /**
   * Resolves each listing's businessId → business name in a single batched
   * query and attaches it as `businessName`. Listings with no businessId
   * (legacy/unassigned) simply get businessName: undefined.
   */
  private async attachBusinessNames(listings: CarListing[]): Promise<CarListingWithBusiness[]> {
    const businessIds = Array.from(
      new Set(listings.map((l) => (l as any).businessId).filter((id): id is string => !!id)),
    );
    if (businessIds.length === 0) return listings as CarListingWithBusiness[];

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
   * GET /cars/listings
   * Public: all active listings. Staff (businessIds provided): only their
   * own business(es)' listings, active or not.
   */
  async getListings(query: GetCarListingsQuery): Promise<{ listings: CarListingWithBusiness[]; total: number }> {
    if (query.businessIds && query.businessIds.length === 0) return { listings: [], total: 0 };

    const qb = this.listingRepository.createQueryBuilder('car');
    if (query.activeOnly !== false) {
      qb.where('car.isActive = :isActive', { isActive: true });
    } else {
      qb.where('1=1');
    }
    if (query.businessIds) {
      qb.andWhere('car."businessId" IN (:...businessIds)', { businessIds: query.businessIds });
    }

    if (query.city) {
      qb.andWhere('LOWER(car.city) LIKE :city', { city: `%${query.city.toLowerCase()}%` });
    }
    if (query.minPrice !== undefined) {
      qb.andWhere('car.pricePerDay >= :minPrice', { minPrice: query.minPrice });
    }
    if (query.maxPrice !== undefined) {
      qb.andWhere('car.pricePerDay <= :maxPrice', { maxPrice: query.maxPrice });
    }
    if (query.transmission) {
      qb.andWhere('car.transmission = :transmission', { transmission: query.transmission });
    }
    if (query.category) {
      qb.andWhere('car.category = :category', { category: query.category });
    }
    if (query.withDriver !== undefined) {
      qb.andWhere('car.withDriver = :withDriver', { withDriver: query.withDriver });
    }

    qb.orderBy('car.createdAt', 'DESC')
      .take(query.limit || 20)
      .skip(query.offset || 0);

    const [listings, total] = await qb.getManyAndCount();
    return { listings: await this.attachBusinessNames(listings), total };
  }

  /**
   * GET /cars/listings/:id
   * Returns a single car listing by ID.
   */
  async getListing(id: string, businessIds?: string[]): Promise<CarListingWithBusiness> {
    const listing = await this.listingRepository.findOne({
      where: { id, isActive: true },
    });
    if (!listing) {
      throw new NotFoundException(`Car listing ${id} not found`);
    }
    if (businessIds !== undefined && (!businessIds.length || !businessIds.includes((listing as any).businessId))) {
      throw new NotFoundException(`Car listing ${id} not found`);
    }
    const [withBusiness] = await this.attachBusinessNames([listing]);
    return withBusiness;
  }

  /**
   * POST /cars/listings  (admin/manager only)
   */
  async createListing(dto: CreateCarListingDto & { businessId?: string | null }): Promise<CarListing> {
    const listing = this.listingRepository.create({
      ...dto,
      features: dto.features || [],
      images: dto.images || [],
      withDriver: dto.withDriver || false,
      isActive: true,
    });
    return this.listingRepository.save(listing);
  }

  /**
   * PATCH /cars/listings/:id  (admin/manager only)
   */
  async updateListing(id: string, dto: UpdateCarListingDto, businessIds?: string[]): Promise<CarListing> {
    const listing = await this.listingRepository.findOne({ where: { id } });
    if (!listing) {
      throw new NotFoundException(`Car listing ${id} not found`);
    }
    if (businessIds !== undefined && (!businessIds.length || !businessIds.includes((listing as any).businessId))) {
      throw new NotFoundException(`Car listing ${id} not found`);
    }
    await this.businessContext.assertBusinessActive((listing as any).businessId); // ← NEW (multi-tenancy)
    Object.assign(listing, dto);
    return this.listingRepository.save(listing);
  }

  /**
   * DELETE /cars/listings/:id  (admin only) — soft delete via isActive flag
   */
  async deactivateListing(id: string, businessIds?: string[]): Promise<{ success: boolean }> {
    const listing = await this.listingRepository.findOne({ where: { id } });
    if (!listing) {
      throw new NotFoundException(`Car listing ${id} not found`);
    }
    if (businessIds !== undefined && (!businessIds.length || !businessIds.includes((listing as any).businessId))) {
      throw new NotFoundException(`Car listing ${id} not found`);
    }
    await this.businessContext.assertBusinessActive((listing as any).businessId); // ← NEW (multi-tenancy)
    listing.isActive = false;
    await this.listingRepository.save(listing);
    return { success: true };
  }
}