import type { DbClient } from '../../db/prisma.js';

/**
 * DEMO DOMAIN -- deleted by `make reset-domain`.
 *
 * The persistence SEAM. The service depends on this interface, never on
 * PrismaClient. Two things that buys us:
 *   - a unit test fakes it in ~15 lines with no database and no container;
 *   - swapping Postgres for something else is one new file, not a rewrite.
 *
 * `ItemRecord` is the DATABASE shape (createdAt is a Date). The wire shape
 * lives in @baseplate/contracts and is produced by the service. Keeping them
 * distinct is what stops a column rename from becoming a breaking API change.
 */
export interface ItemRecord {
  id: string;
  name: string;
  quantity: number;
  createdAt: Date;
}

export interface CreateItemData {
  name: string;
  quantity: number;
}

export interface ListItemsOptions {
  /** Rows to return. The repository fetches limit+1 internally to detect a
   *  next page without a second COUNT query. */
  limit: number;
  /** Id of the last row of the previous page, or undefined for the first page. */
  cursor?: string | undefined;
}

export interface ListItemsResult {
  items: ItemRecord[];
  nextCursor: string | null;
}

export interface ItemRepository {
  /**
   * Every method takes the db client as its first argument rather than
   * capturing one. That is what lets the caller pass a transaction client and
   * compose this write with others atomically.
   */
  create(db: DbClient, data: CreateItemData): Promise<ItemRecord>;
  list(db: DbClient, options: ListItemsOptions): Promise<ListItemsResult>;
  findById(db: DbClient, id: string): Promise<ItemRecord | null>;
}
