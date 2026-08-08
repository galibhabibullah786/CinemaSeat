import type { Prisma } from '../../generated/prisma/index.js';

import type { DbClient } from '../db/prisma.js';
import type {
  IdempotencyRepository,
  NewIdempotencyRecord,
  StoredResponse,
} from './idempotency.js';

/**
 * Prisma-backed idempotency ledger.
 *
 * Note every method takes the `DbClient` as an argument instead of closing over
 * one. That is what allows the caller to pass a TRANSACTION client, so the
 * dedupe row and the business effect commit or roll back together. A repository
 * that captures its own client cannot participate in someone else's
 * transaction, and idempotency implemented outside the transaction is not
 * idempotency -- it is a race with extra steps.
 */
export class PrismaIdempotencyRepository implements IdempotencyRepository {
  async find(db: DbClient, endpoint: string, key: string): Promise<StoredResponse | null> {
    const row = await db.idempotencyRecord.findUnique({
      where: { endpoint_key: { endpoint, key } },
      select: { requestHash: true, statusCode: true, responseBody: true },
    });

    if (!row) return null;

    return {
      requestHash: row.requestHash,
      statusCode: row.statusCode,
      responseBody: row.responseBody,
    };
  }

  async insert(db: DbClient, record: NewIdempotencyRecord): Promise<void> {
    // Plain `create`, NOT `upsert`. An upsert would silently overwrite the
    // stored response and destroy the guarantee. We WANT the unique violation:
    // it is how the database tells us another transaction won the race.
    await db.idempotencyRecord.create({
      data: {
        endpoint: record.endpoint,
        key: record.key,
        requestHash: record.requestHash,
        statusCode: record.statusCode,
        responseBody: record.responseBody as Prisma.InputJsonValue,
      },
    });
  }
}
