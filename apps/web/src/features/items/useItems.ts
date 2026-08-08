import { useCallback, useEffect, useRef, useState } from 'react';

import type { CreateItemBody, Item } from '@baseplate/contracts';

import { createItem, listItems, newIdempotencyKey } from '../../api/items.js';

/**
 * DEMO DOMAIN -- deleted by `make reset-domain`.
 *
 * A discriminated union, not `{ loading, error, data }`.
 *
 * Three independent fields allow eight states, of which five are nonsense
 * ("loading AND error", "done but no data and no error"). Every component
 * consuming them then needs defensive `if (loading && !error)` chains, and one
 * missing branch is a blank screen. A union makes the impossible states
 * unrepresentable and forces the UI to handle each real one exactly once.
 */
export type ItemsState =
  | { status: 'loading' }
  | { status: 'error'; error: unknown }
  | { status: 'ready'; items: Item[] };

export interface UseItemsResult {
  state: ItemsState;
  /** True while a create is in flight -- separate from the list's own loading
   *  state so the list does not flash a spinner when you add a row. */
  isCreating: boolean;
  create: (body: CreateItemBody) => Promise<Item>;
  reload: () => void;
}

export function useItems(): UseItemsResult {
  const [state, setState] = useState<ItemsState>({ status: 'loading' });
  const [isCreating, setIsCreating] = useState(false);

  // Guards against setting state after unmount, and against a slow first
  // request resolving AFTER a later one and overwriting fresher data.
  const activeRequest = useRef<AbortController | null>(null);
  const isMounted = useRef(true);

  const load = useCallback(() => {
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;

    setState({ status: 'loading' });

    listItems({ signal: controller.signal })
      .then((response) => {
        // Ignore a response whose request was superseded or unmounted.
        if (controller.signal.aborted || !isMounted.current) return;
        setState({ status: 'ready', items: response.items });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || !isMounted.current) return;
        setState({ status: 'error', error });
      });
  }, []);

  useEffect(() => {
    isMounted.current = true;
    load();
    return () => {
      isMounted.current = false;
      activeRequest.current?.abort();
    };
  }, [load]);

  const create = useCallback(async (body: CreateItemBody): Promise<Item> => {
    setIsCreating(true);
    try {
      /**
       * One key per submit attempt. If the response is lost to a flaky network
       * and the user presses Add again, the server recognises the key and
       * replays the original response instead of creating a second item.
       */
      const created = await createItem(body, { idempotencyKey: newIdempotencyKey() });

      // Optimistic-but-honest: insert the server's own response object, not a
      // locally-constructed guess. The row shown is exactly the row stored.
      if (isMounted.current) {
        setState((current) =>
          current.status === 'ready'
            ? { status: 'ready', items: [created, ...current.items] }
            : current,
        );
      }
      return created;
    } finally {
      // `finally` so a failed create can never leave the button disabled
      // forever -- a stuck spinner is the most common form of this bug.
      if (isMounted.current) setIsCreating(false);
    }
  }, []);

  return { state, isCreating, create, reload: load };
}
