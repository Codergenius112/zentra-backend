import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddEscortToCarListings1787600000000 implements MigrationInterface {
  name = 'AddEscortToCarListings1787600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add escortAvailable flag (default OFF so existing listings are unaffected)
    await queryRunner.query(
      `ALTER TABLE "car_listings" ADD COLUMN IF NOT EXISTS "escortAvailable" boolean NOT NULL DEFAULT false`,
    );
    // Add escortPrice — price in Naira set by admin per listing
    await queryRunner.query(
      `ALTER TABLE "car_listings" ADD COLUMN IF NOT EXISTS "escortPrice" numeric(12,2) NOT NULL DEFAULT 0`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "car_listings" DROP COLUMN IF EXISTS "escortPrice"`);
    await queryRunner.query(`ALTER TABLE "car_listings" DROP COLUMN IF EXISTS "escortAvailable"`);
  }
}
