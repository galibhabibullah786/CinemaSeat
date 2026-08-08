import type { DbClient } from '../../db/prisma.js';
import type {
  CreateItemData,
  ItemRecord,
  ItemRepository,
  ListItemsOptions,
  ListItemsResult,
} from './item.repository.js';

/** DEMO DOMAIN -- deleted by `make reset-domain`. */
export class PrismaItemRepository implements ItemRepository {
  async create(db: DbClient, data: CreateItemData): Promise<ItemRecord> {
    return db.item.create({
      data: { name: data.name, quantity: data.quantity },
      select: SELECT_ITEM,
    });
  }

  async findById(db: DbClient, id: string): Promise<ItemRecord | null> {
    return db.item.findUnique({ where: { id }, select: SELECT_ITEM });
  }

  async list(db: DbClient, options: ListItemsOptions): Promise<ListItemsResult> {
    const { limit, cursor } = options;

    /**
     * Keyset pagination, not OFFSET.
     *
     * OFFSET N makes Postgres read and discard N rows -- page 500 costs 500x
     * page 1 -- and it SKIPS rows when a concurrent insert shifts the window,
     * so a client paging through a live list silently misses records.
     *
     * Fetch limit+1: the extra row answers "is there a next page?" without a
     * second COUNT(*) over the whole table.
     */
    const rows = await db.item.findMany({
      take: limit + 1,
      // The ORDER BY matches the composite index in schema.prisma exactly, so
      // this is an index scan rather than a sort of the whole table.
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: SELECT_ITEM,
    });

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;

    // `items.at(-1)` is `ItemRecord | undefined` under noUncheckedIndexedAccess,
    // and the compiler is right: `items` is empty when the table is.
    const last = items.at(-1);

    return {
      items,
      nextCursor: hasMore && last ? last.id : null,
    };
  }
}

/**
 * Explicit column list rather than an implicit SELECT *.
 *
 * Adding a sensitive column to the model later (an internal note, a soft-delete
 * flag, an owner id) must not automatically start returning it to clients. An
 * explicit projection makes exposure a deliberate edit.
 */
const SELECT_ITEM = {
  id: true,
  name: true,
  quantity: true,
  createdAt: true,
} as const;
