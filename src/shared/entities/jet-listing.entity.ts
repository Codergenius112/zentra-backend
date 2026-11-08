import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn, Index,
} from 'typeorm';

@Entity('jet_listings')
@Index('idx_jet_listings_active', ['isActive'])
@Index('idx_jet_listings_city', ['city'])
@Index('idx_jet_listings_category', ['category'])
export class JetListing {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 150 })
  name: string;

  @Column({ type: 'varchar', length: 100 })
  model: string;

  @Column({ type: 'varchar', length: 100 })
  manufacturer: string;

  @Column({ type: 'varchar', length: 50, default: 'MIDSIZE_JET' })
  category: string;

  @Column({ type: 'varchar', length: 50 })
  tailNumber: string;

  @Column({ type: 'integer', default: 8 })
  capacity: number;

  @Column({ type: 'integer', nullable: true })
  rangeNauticalMiles: number | null;

  @Column({ type: 'integer', nullable: true })
  cruisingSpeedKnots: number | null;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  pricePerHour: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  cautionFee: number;

  @Column({ type: 'boolean', default: true })
  cautionFeeRefundable: boolean;

  @Column({ type: 'varchar', length: 100 })
  baseAirport: string;

  @Column({ type: 'varchar', length: 100 })
  city: string;

  @Column({ type: 'varchar', length: 100, default: 'Nigeria' })
  country: string;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'jsonb', default: '[]' })
  features: string[];

  @Column({ type: 'jsonb', default: '[]' })
  amenities: string[];

  @Column({ type: 'jsonb', default: '[]' })
  images: string[];

  @Column({ type: 'simple-array', nullable: true })
  unavailableDates: string[] | null;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @Column({ type: 'boolean', default: false })
  isDeleted: boolean;

  @Column({ type: 'uuid', nullable: true })
  managedBy: string | null;

  @Column({ type: 'uuid', nullable: true })
  businessId: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
