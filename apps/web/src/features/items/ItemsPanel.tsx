import { useState, type FormEvent, type ReactNode } from 'react';

import { ApiError, userMessageFor } from '../../api/errors.js';
import { useToast } from '../../components/toast-context.js';
import { useItems } from './useItems.js';

/** DEMO DOMAIN -- deleted by `make reset-domain`. */
export function ItemsPanel(): ReactNode {
  const { state, isCreating, create, reload } = useItems();
  const toast = useToast();

  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('1');

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    // Client-side check for immediacy only. The SERVER is the enforcement
    // layer -- it re-validates with the same zod schema, because anything a
    // browser checks can be bypassed with curl.
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      toast.showError('Name must not be empty.');
      return;
    }

    const parsedQuantity = Number.parseInt(quantity, 10);
    if (!Number.isFinite(parsedQuantity) || parsedQuantity < 0) {
      toast.showError('Quantity must be a whole number of at least 0.');
      return;
    }

    try {
      await create({ name: trimmed, quantity: parsedQuantity });
      setName('');
      setQuantity('1');
      toast.showSuccess('Item added.');
    } catch (error) {
      // `userMessageFor` returns OUR copy. The server's message is never
      // rendered -- it goes to the console and to the requestId chip.
      toast.showError(
        userMessageFor(error),
        error instanceof ApiError ? error.requestId : undefined,
      );
    }
  }

  return (
    <section className="panel">
      <header className="panel__header">
        <h2>Items</h2>
        <button type="button" onClick={reload} disabled={state.status === 'loading'}>
          Refresh
        </button>
      </header>

      <form className="item-form" onSubmit={(e) => void onSubmit(e)}>
        <label>
          <span>Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. widget"
            maxLength={200}
            disabled={isCreating}
            data-testid="item-name"
          />
        </label>
        <label>
          <span>Quantity</span>
          <input
            type="number"
            min={0}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            disabled={isCreating}
            data-testid="item-quantity"
          />
        </label>
        <button type="submit" disabled={isCreating} data-testid="item-submit">
          {isCreating ? 'Adding…' : 'Add item'}
        </button>
      </form>

      {renderList()}
    </section>
  );

  function renderList(): ReactNode {
    // Every branch of the union is handled. Adding a new state to ItemsState
    // makes this function fail to compile until it is handled here too.
    switch (state.status) {
      case 'loading':
        return (
          <p className="state state--loading" data-testid="items-loading">
            Loading items…
          </p>
        );

      case 'error':
        return (
          <div className="state state--error" role="alert" data-testid="items-error">
            <p>{userMessageFor(state.error)}</p>
            <button type="button" onClick={reload}>
              Retry
            </button>
          </div>
        );

      case 'ready':
        // The empty state is a FIRST-CLASS case, not an accidental blank list.
        // "It looks broken" on first run is almost always a missing empty state.
        if (state.items.length === 0) {
          return (
            <p className="state state--empty" data-testid="items-empty">
              No items yet. Add the first one above.
            </p>
          );
        }

        return (
          <ul className="item-list" data-testid="items-list">
            {state.items.map((item) => (
              <li key={item.id} className="item">
                <span className="item__name">{item.name}</span>
                <span className="item__qty">{item.quantity}</span>
                <time className="item__time" dateTime={item.createdAt}>
                  {new Date(item.createdAt).toLocaleString()}
                </time>
              </li>
            ))}
          </ul>
        );
    }
  }
}
