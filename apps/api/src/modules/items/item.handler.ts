import type { RequestHandler } from 'express';

import { CreateItemBodySchema, ListItemsQuerySchema } from '@baseplate/contracts';
import { z } from 'zod';

import { asyncRoute } from '../../http/async-route.js';
import { parseOrThrow } from '../../http/validate.js';
import { readIdempotencyKey } from '../../idempotency/idempotency.js';
import type { ItemService } from './item.service.js';

/** DEMO DOMAIN -- deleted by `make reset-domain`. */

/** Path params are strings until proven otherwise -- including the ones that
 *  "obviously" look like a uuid. An invalid uuid must be a 400, not a database
 *  error surfaced as a 500. */
const ItemIdParamsSchema = z.object({ id: z.string().uuid('id must be a UUID') });

/**
 * The transport layer. Its entire job:
 *   1. validate untrusted input,
 *   2. call the service with parsed values,
 *   3. turn the result into a response.
 *
 * No business rules here. If a condition needs a database read to evaluate, it
 * belongs in the service; if it needs to be true across concurrent requests, it
 * belongs in a constraint.
 */
export class ItemHandler {
  constructor(private readonly service: ItemService) {}

  /** Ledger scope for POST /items. A constant so a route rename cannot silently
   *  orphan every previously issued key. */
  private static readonly CREATE_ENDPOINT = 'POST /items';

  readonly list: RequestHandler = asyncRoute(async (req, res) => {
    const query = parseOrThrow(ListItemsQuerySchema, req.query);
    const result = await this.service.list(query);
    res.status(200).json(result);
  });

  readonly getById: RequestHandler = asyncRoute(async (req, res) => {
    const { id } = parseOrThrow(ItemIdParamsSchema, req.params);
    const item = await this.service.getById(id);
    res.status(200).json(item);
  });

  readonly create: RequestHandler = asyncRoute(async (req, res) => {
    const body = parseOrThrow(CreateItemBodySchema, req.body);

    const result = await this.service.create(body, {
      idempotencyKey: readIdempotencyKey(req.headers['idempotency-key']),
      endpoint: ItemHandler.CREATE_ENDPOINT,
    });

    // A replayed response is byte-for-byte the original, headers included.
    // Deliberate: a client holding a receipt must not be able to tell the
    // difference, and any distinguishing header would tempt them to branch on it.
    res.status(result.status).location(`/items/${result.item.id}`).json(result.item);
  });
}
