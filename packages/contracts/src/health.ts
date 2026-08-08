import { z } from 'zod';

/**
 * GET /health -- process liveness. 200 whenever the event loop is turning.
 * Deliberately checks NOTHING external: see the README section "health vs
 * readiness" for why coupling liveness to a dependency causes restart storms.
 */
export const HealthResponseSchema = z.object({
  status: z.literal('ok'),
  uptimeSeconds: z.number().nonnegative(),
  version: z.string(),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

/** One dependency's verdict. `error` is a short safe label, never a driver
 *  message -- those leak hostnames, ports and usernames. */
export const DependencyCheckSchema = z.object({
  ok: z.boolean(),
  latencyMs: z.number().nonnegative().optional(),
  error: z.string().optional(),
});
export type DependencyCheck = z.infer<typeof DependencyCheckSchema>;

/**
 * GET /ready -- can this process serve traffic right now?
 * 200 when every dependency is reachable, 503 otherwise. A load balancer uses
 * this to take an instance out of rotation WITHOUT killing it.
 */
export const ReadyResponseSchema = z.object({
  status: z.enum(['ready', 'not_ready']),
  checks: z.object({
    database: DependencyCheckSchema,
  }),
});
export type ReadyResponse = z.infer<typeof ReadyResponseSchema>;
