import { useEffect, useState, type ReactNode } from 'react';

import { apiBaseUrl } from '../api/client.js';
import { fetchReady } from '../api/health.js';

type Status = 'checking' | 'ready' | 'unavailable';

const POLL_INTERVAL_MS = 15_000;

/**
 * A status dot for the API's /ready endpoint.
 *
 * Survives `make reset-domain`. During a demo it answers the single most
 * expensive question -- "is the backend down, or did I break my feature?" --
 * in under a second, without opening a terminal.
 */
export function ApiStatus(): ReactNode {
  const [status, setStatus] = useState<Status>('checking');

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    const check = (): void => {
      fetchReady(controller.signal)
        .then((response) => {
          if (!cancelled) setStatus(response.status === 'ready' ? 'ready' : 'unavailable');
        })
        .catch(() => {
          // A 503 is a rejected promise here, and it is the EXPECTED answer
          // when a dependency is down -- not an exception worth logging.
          if (!cancelled) setStatus('unavailable');
        });
    };

    check();
    const timer = setInterval(check, POLL_INTERVAL_MS);

    // Both the interval and the in-flight request are cancelled on unmount.
    // Leaving either running is how a SPA ends up making requests for a page
    // the user left ten minutes ago.
    return () => {
      cancelled = true;
      clearInterval(timer);
      controller.abort();
    };
  }, []);

  return (
    <span className={`api-status api-status--${status}`} data-testid="api-status">
      <span className="api-status__dot" aria-hidden="true" />
      {/* The base URL is public by construction -- it is already visible in
          every network request the browser makes. Showing it removes a whole
          class of "which environment am I pointed at?" confusion. */}
      <span title={apiBaseUrl}>
        {status === 'checking' ? 'checking API…' : status === 'ready' ? 'API ready' : 'API unavailable'}
      </span>
    </span>
  );
}
