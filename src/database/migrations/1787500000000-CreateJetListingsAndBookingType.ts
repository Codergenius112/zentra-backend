import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateJetListingsAndBookingType1787500000000 implements MigrationInterface {
  name = 'CreateJetListingsAndBookingType1787500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Add 'jet' to bookings_bookingtype_enum
    await queryRunner.query(`
      ALTER TYPE "public"."bookings_bookingtype_enum" ADD VALUE IF NOT EXISTS 'jet'
    `);

    // 2. Create jet_listings table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "jet_listings" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" character varying(150) NOT NULL,
        "model" character varying(100) NOT NULL,
        "manufacturer" character varying(100) NOT NULL,
        "category" character varying(50) NOT NULL DEFAULT 'MIDSIZE_JET',
        "tailNumber" character varying(50) NOT NULL,
        "capacity" integer NOT NULL DEFAULT 8,
        "rangeNauticalMiles" integer,
        "cruisingSpeedKnots" integer,
        "pricePerHour" numeric(12,2) NOT NULL,
        "cautionFee" numeric(12,2) NOT NULL DEFAULT 0,
        "cautionFeeRefundable" boolean NOT NULL DEFAULT true,
        "baseAirport" character varying(100) NOT NULL,
        "city" character varying(100) NOT NULL,
        "country" character varying(100) NOT NULL DEFAULT 'Nigeria',
        "description" text NOT NULL,
        "features" jsonb NOT NULL DEFAULT '[]',
        "amenities" jsonb NOT NULL DEFAULT '[]',
        "images" jsonb NOT NULL DEFAULT '[]',
        "unavailableDates" text,
        "isActive" boolean NOT NULL DEFAULT true,
        "isDeleted" boolean NOT NULL DEFAULT false,
        "managedBy" uuid,
        "businessId" uuid,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_jet_listings_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_jet_listings_active" ON "jet_listings" ("isActive")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_jet_listings_city" ON "jet_listings" ("city")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_jet_listings_category" ON "jet_listings" ("category")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_jet_listings_business_id" ON "jet_listings" ("businessId")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_jet_listings_business_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_jet_listings_category"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_jet_listings_city"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_jet_listings_active"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "jet_listings"`);
  }
}
