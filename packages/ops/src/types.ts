/**
 * The panel's own vocabulary.
 *
 * Kept apart from the database schema so a screen can talk about a "degraded"
 * dependency without importing a table definition, and so the health status
 * used in code is the same three words the CHECK constraint allows.
 */

export const HEALTH_STATUSES = ['ok', 'degraded', 'down'] as const;
export type HealthStatus = (typeof HEALTH_STATUSES)[number];

export const PROCESSES = ['web', 'bot'] as const;
export type ProcessName = (typeof PROCESSES)[number];

/** The five surfaces §11.9 asks to be counted separately. */
export const SURFACES = ['staff', 'admin', 'device', 'demand_api', 'chat'] as const;
export type Surface = (typeof SURFACES)[number];

export const isSurface = (value: string): value is Surface =>
  (SURFACES as readonly string[]).includes(value);
