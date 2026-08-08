import type { ReactNode } from 'react';

import { ApiStatus } from './components/ApiStatus.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';
import { ToastProvider } from './components/Toast.js';

// >>> DEMO-DOMAIN:items -- removed by scripts/reset-domain.sh
import { ItemsPanel } from './features/items/ItemsPanel.js';
// <<< DEMO-DOMAIN:items

/**
 * Application shell.
 *
 * Provider order matters: ToastProvider is INSIDE ErrorBoundary so that a
 * crash in the toast layer is still caught, and the feature panels are inside
 * both so they can raise toasts and be caught when they throw.
 */
export function App(): ReactNode {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <div className="app">
          <header className="app__header">
            <h1>Hackathon Baseplate</h1>
            <ApiStatus />
          </header>

          <main className="app__main">
            {/*
              A second boundary around the feature subtree: a crash in one
              feature leaves the shell -- and the API status indicator -- alive,
              instead of blanking the whole page.
            */}
            <ErrorBoundary>
              {/* >>> DEMO-DOMAIN:items -- removed by scripts/reset-domain.sh */}
              <ItemsPanel />
              {/* <<< DEMO-DOMAIN:items */}
            </ErrorBoundary>
          </main>

          <footer className="app__footer">
            <p>
              Delete the demo domain with <code>make reset-domain</code>, then build the real thing.
            </p>
          </footer>
        </div>
      </ToastProvider>
    </ErrorBoundary>
  );
}
