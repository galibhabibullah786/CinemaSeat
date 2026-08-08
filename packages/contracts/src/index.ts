/**
 * The single source of truth for every type that crosses the network boundary.
 *
 * Rule: if the API returns it or accepts it, its schema is defined HERE and
 * imported by both sides. The web app never redeclares a DTO -- that is the
 * drift we are designing out.
 */
export * from './errors.js';
export * from './health.js';

// >>> DEMO-DOMAIN:items -- removed by scripts/reset-domain.sh
export * from './item.js';
// <<< DEMO-DOMAIN:items
