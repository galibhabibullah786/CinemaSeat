import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.js';
import './styles.css';

const container = document.getElementById('root');

/**
 * Explicit, loud failure instead of `document.getElementById('root')!`.
 *
 * The non-null assertion turns a missing element into
 * "Cannot read properties of null (reading 'appendChild')" -- a message that
 * tells you nothing about the actual cause, which is an index.html that no
 * longer matches this file.
 */
if (!container) {
  throw new Error('Mount point #root is missing from index.html — cannot start the app.');
}

createRoot(container).render(
  // StrictMode double-invokes effects in development on purpose: it surfaces
  // missing cleanup. Every effect in this app is written to survive it.
  <StrictMode>
    <App />
  </StrictMode>,
);
