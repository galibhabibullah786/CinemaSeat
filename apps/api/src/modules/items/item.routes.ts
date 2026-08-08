import { Router } from 'express';

import type { ItemHandler } from './item.handler.js';

/** DEMO DOMAIN -- deleted by `make reset-domain`. */
export function itemRoutes(handler: ItemHandler): Router {
  const router = Router();

  // Order matters: '/:id' would otherwise swallow any literal sub-path added
  // later (e.g. '/search'). Specific routes first is the habit that avoids it.
  router.get('/', handler.list);
  router.post('/', handler.create);
  router.get('/:id', handler.getById);

  return router;
}
