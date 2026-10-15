import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * wallet.service.ts's debit()/transfer() and queues.service.ts's
 * join/call/checkin/cancel methods were logging audit actions via
 * `'WALLET_DEBIT' as any`, `'WALLET_TRANSFER' as any`, `'QUEUE_JOINED' as
 * any`, `'QUEUE_CALLED' as any`, `'QUEUE_CHECKIN' as any`, and
 * `'QUEUE_CANCELLED' as any` — none of which existed in either the
 * TypeScript AuditActionType enum or this Postgres enum type. The `as any`
 * suppressed the compile-time check, but the actual INSERT still failed at
 * the database with "invalid input value for enum
 * audit_logs_actiontype_enum" — and because these audit calls run AFTER the
 * wallet balance / queue state mutation has already committed (see
 * wallet.service.ts, queues.service.ts), the money/state change had already
 * happened by the time the request failed with an unhandled 500. A retry
 * after that 500 (reasonably, since the client just saw a failure) repeats
 * the whole mutation — e.g. a second wallet credit for a card that was only
 * charged once.
 *
 * This is the same class of bug 1787300000000 and 1786600000001 fixed for
 * other modules — the app-level enum and the DB enum are two separate
 * things that must be synced explicitly, there is no single source of
 * truth enforced automatically.
 */
export class AddWalletQueueAuditActionEnumValues1787400000000 implements MigrationInterface {
  name = 'AddWalletQueueAuditActionEnumValues1787400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const values = [
      'WALLET_DEBITED',
      'WALLET_TRANSFERRED',
      'QUEUE_JOINED',
      'QUEUE_CALLED',
      'QUEUE_CHECKED_IN',
      'QUEUE_CANCELLED',
    ];
    for (const value of values) {
      await queryRunner.query(`
        ALTER TYPE "audit_logs_actiontype_enum"
        ADD VALUE IF NOT EXISTS '${value}'
      `);
    }
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // Postgres does not support removing a value from an enum type directly.
    // A rollback would require recreating the enum type and column, which
    // is destructive — intentionally left as a no-op (matches the existing
    // convention in this codebase, see 1786600000001 and 1787300000000).
  }
}