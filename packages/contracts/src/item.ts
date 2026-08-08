/**
 * DEMO DOMAIN -- "items". Deliberately trivial and disposable.
 *
 * This whole file is deleted by `make reset-domain` at the start of a
 * hackathon. It exists to prove the seam: one zod schema here becomes the
 * server's validation, the server's response type, and the web app's DTO --
 * with no second declaration anywhere.
 */
import { z } from 'zod';

/** Shared field rules. Declared once so the create schema and the entity
 *  schema can never drift apart. */
const itemName = z.string().trim().min(1, 'name must not be empty').max(200);
const itemQuantity = z
  .number({ invalid_type_error: 'quantity must be a number' })
  .int('quantity must be a whole number')
  .min(0, 'quantity must not be negative')
  .max(1_000_000);

/** An item as it crosses the wire. `createdAt` is ISO-8601 UTC, not a Date:
 *  JSON has no date type and inventing one costs an hour of debugging. */
export const ItemSchema = z.object({
  id: z.string().uuid(),
  name: itemName,
  quantity: itemQuantity,
  createdAt: z.string().datetime(),
});
export type Item = z.infer<typeof ItemSchema>;

/**
 * POST /items request body.
 *
 * `.strict()` rejects unknown keys instead of silently dropping them. A typo'd
 * field name should be a 400 the client can see, not a value that vanishes.
 */
export const CreateItemBodySchema = z
  .object({
    name: itemName,
    quantity: itemQuantity.default(1),
  })
  .strict();

/** What a client SENDS (quantity optional -- it has a default). */
export type CreateItemBody = z.input<typeof CreateItemBodySchema>;
/** What the server WORKS WITH after parsing (quantity always present). */
export type CreateItemInput = z.output<typeof CreateItemBodySchema>;

/**
 * GET /items query. `coerce` because query strings are always strings; the
 * boundary is the only correct place to do that conversion.
 */
export const ListItemsQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    /** Keyset pagination cursor: the id of the last item on the previous page.
     *  Keyset, not OFFSET, because OFFSET degrades linearly and skips rows when
     *  concurrent inserts shift the window. */
    cursor: z.string().uuid().optional(),
  })
  .strict();
export type ListItemsQuery = z.input<typeof ListItemsQuerySchema>;
export type ListItemsParams = z.output<typeof ListItemsQuerySchema>;

export const ItemListResponseSchema = z.object({
  items: z.array(ItemSchema),
  /** null means "no further pages", which is different from "unknown". */
  nextCursor: z.string().uuid().nullable(),
});
export type ItemListResponse = z.infer<typeof ItemListResponseSchema>;
