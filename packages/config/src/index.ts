/**
 * Clinical configuration as data, not constants (§12).
 *
 * §14 names hard-coded clinical thresholds as a risk and §12.1 makes it a
 * compliance point: guidelines get revised, and a code deploy is the wrong way
 * to adopt a new inter-donation interval. So every threshold below is a row in
 * `app_config`, read through this package, validated by Zod, cached briefly, and
 * audited on every change.
 *
 * Three rules this package exists to keep (§12):
 *
 *  1. **`packages/domain` never reads config.** Thresholds are passed into pure
 *     functions as parameters. That is what keeps the domain testable without a
 *     database and what stops a rule quietly depending on ambient state.
 *  2. **The SQL wave query and the TypeScript predicate read the same keys**
 *     (§7.7), so a revised interval cannot move one and not the other.
 *  3. **Shelf lives and the stock floor are not here.** They live in
 *     `product_shelf_lives` and `centre_settings` because they are edited on the
 *     centre settings screen (§15); `app_config` holds what has no screen.
 */

import { z } from 'zod';

const positiveInt = z.number().int().positive();
const nonNegativeInt = z.number().int().nonnegative();

export const appConfigSchema = z.object({
  donor: z.object({
    minAge: positiveInt,
    maxAge: positiveInt,
    minWeightKg: z.number().positive(),
    intervalDays: z.object({
      male: positiveInt,
      female: positiveInt,
      /**
       * The national guideline addresses men and women. `other` is not covered,
       * so this system applies the longer of the two by default — the safe
       * direction. Open question #1 puts the wording in front of the centre.
       */
      other: positiveInt,
    }),
  }),

  wave: z.object({
    size: positiveInt,
    intervalMinutes: positiveInt,
    /** `null` is the spec's default: waves continue until the demand closes. */
    maxWaves: positiveInt.nullable(),
  }),

  vision: z.object({
    confidenceThreshold: z.number().min(0).max(1),
    driftThreshold: z.number().min(0).max(1),
    captureSchedule: z.string().min(1),
    /** Shadow mode is **on** by default and stays on without evidence (§4, §14). */
    shadowMode: z.boolean(),
  }),

  auth: z.object({
    inviteTtlHours: positiveInt,
    otpTtlMinutes: positiveInt,
    otpMaxAttempts: positiveInt,
    loginThrottle: z.object({
      windowMinutes: positiveInt,
      maxAttemptsPerAccount: positiveInt,
      maxAttemptsPerIp: positiveInt,
    }),
    minPasswordLength: positiveInt,
  }),

  /**
   * How urgency becomes a date, and how long the centre has (§3, ADR 0010).
   *
   * The doctor picks a level; these turn it into the `date_required` everything
   * downstream runs on, and into the minute clock the queue flags against.
   * Exactly the numbers a centre will want to tune in its first month, which is
   * why they are rows rather than constants (§12, §14).
   */
  request: z.object({
    /** Days from today, per urgency. Three of the four are the same day. */
    urgencyDays: z.object({
      emergency: nonNegativeInt,
      very_urgent: nonNegativeInt,
      urgent: nonNegativeInt,
      routine: nonNegativeInt,
    }),
    /**
     * Minutes within which an answer is expected, or `null` for no clock.
     *
     * Routine has none deliberately: its needed-by is days away and the expiry
     * sweep is the right instrument. Flagging it after four hours would train
     * the counter to ignore the flag.
     */
    responseMinutes: z.object({
      emergency: positiveInt,
      very_urgent: positiveInt,
      urgent: positiveInt,
      routine: positiveInt.nullable(),
    }),
  }),

  /**
   * Where the stock chart turns from orange to red (§4).
   *
   * The floor itself is **not** here — it is `centre_settings.min_units_per_group`,
   * edited on the settings screen. This is the one boundary below it that has no
   * screen: at what share of the floor a group stops being merely low and starts
   * being the thing somebody should act on tonight.
   */
  stock: z
    .object({
      /**
       * At or above this share of the floor, a group is merely **low** — worth
       * watching. Below it, the centre should be recruiting.
       */
      lowFraction: z.number().gt(0).max(1),
      /**
       * Below this share of the floor, a group is **critically low**: recruit
       * tonight, not this week.
       *
       * The outer two boundaries are structural rather than tunable — at or
       * above the floor is adequate by definition, and an empty shelf is its own
       * state whatever the floor says.
       */
      criticalFraction: z.number().gt(0).max(1),
    })
    .describe('Stock chart bands'),

  ageing: z.object({
    quarantineDays: nonNegativeInt,
    reconciliationHours: nonNegativeInt,
    inviteDays: nonNegativeInt,
    draftDays: nonNegativeInt,
  }),

  retention: z.object({
    framesDays: nonNegativeInt,
    journeyMonths: nonNegativeInt,
    donorTailDays: nonNegativeInt,
  }),

  flag: z.object({
    visionEnabled: z.boolean(),
    whatsappChannel: z.boolean(),
    publicBoard: z.boolean(),
    externalDemandApi: z.boolean(),
  }),
});

export type AppConfig = z.infer<typeof appConfigSchema>;

/**
 * Defaults, from §12's table. These are what a fresh database starts with; every
 * one of them is overridable by a row, and the ones marked by an open question
 * in the architecture plan are expected to be corrected by the centre rather
 * than by a commit.
 */
export const CONFIG_DEFAULTS: AppConfig = {
  donor: {
    minAge: 18,
    maxAge: 65,
    minWeightKg: 45,
    intervalDays: { male: 90, female: 120, other: 120 },
  },
  wave: { size: 20, intervalMinutes: 30, maxWaves: null },
  vision: {
    confidenceThreshold: 0.85,
    driftThreshold: 0.2,
    captureSchedule: '0 */4 * * *',
    shadowMode: true,
  },
  auth: {
    inviteTtlHours: 48,
    otpTtlMinutes: 10,
    otpMaxAttempts: 5,
    loginThrottle: { windowMinutes: 15, maxAttemptsPerAccount: 5, maxAttemptsPerIp: 20 },
    minPasswordLength: 12,
  },
  /**
   * Three fifths and three tenths of the floor.
   *
   * Against a floor of 25 that reads: 15 and up is worth watching, 8 to 14 means
   * recruit, below 8 means recruit tonight. Expected to be corrected by the
   * centre rather than by a commit — these are the numbers a blood centre has an
   * opinion about.
   */
  /**
   * Emergency, very urgent and urgent all mean today; routine means this week.
   * The minute clock is what separates the first three.
   */
  request: {
    urgencyDays: { emergency: 0, very_urgent: 0, urgent: 0, routine: 7 },
    responseMinutes: { emergency: 15, very_urgent: 60, urgent: 240, routine: null },
  },
  stock: { lowFraction: 0.6, criticalFraction: 0.3 },
  ageing: { quarantineDays: 7, reconciliationHours: 24, inviteDays: 7, draftDays: 3 },
  retention: { framesDays: 30, journeyMonths: 24, donorTailDays: 90 },
  flag: {
    visionEnabled: false,
    whatsappChannel: false,
    publicBoard: false,
    externalDemandApi: false,
  },
};

/* -------------------------------------------------------------------------- */
/* Storage keys                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Rows are stored under the dotted keys §12 names (`donor.interval_days.male`),
 * so the SQL wave query and this loader ask for the same string. The mapping
 * between a dotted key and its place in the typed object lives here and nowhere
 * else.
 */
const toSnake = (segment: string): string =>
  segment.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

const toCamel = (segment: string): string =>
  segment.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

function* walk(
  value: unknown,
  path: readonly string[] = [],
): Generator<readonly string[]> {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) {
      yield* walk(child, [...path, key]);
    }
    return;
  }
  yield path;
}

/** Every configurable key, in storage form. Used to seed and to validate rows. */
export const CONFIG_KEYS: readonly string[] = [...walk(CONFIG_DEFAULTS)].map((path) =>
  path.map(toSnake).join('.'),
);

export const isConfigKey = (key: string): boolean => CONFIG_KEYS.includes(key);

const getAt = (source: unknown, path: readonly string[]): unknown =>
  path.reduce<unknown>(
    (node, segment) =>
      node !== null && typeof node === 'object'
        ? (node as Record<string, unknown>)[segment]
        : undefined,
    source,
  );

/** The default for one dotted key, so a seed can write the whole table. */
export const defaultFor = (key: string): unknown =>
  getAt(CONFIG_DEFAULTS, key.split('.').map(toCamel));

/* -------------------------------------------------------------------------- */
/* Resolution                                                                  */
/* -------------------------------------------------------------------------- */

export type ConfigOverrides = Readonly<Record<string, unknown>>;

export type ConfigProblem =
  | { readonly kind: 'unknown_key'; readonly key: string }
  | { readonly kind: 'invalid_value'; readonly key: string; readonly message: string };

export type ConfigResolution =
  | { readonly ok: true; readonly config: AppConfig }
  | { readonly ok: false; readonly problems: readonly ConfigProblem[] };

function clone<T>(value: T): T {
  return structuredClone(value);
}

function setAt(target: Record<string, unknown>, path: readonly string[], value: unknown): void {
  const last = path[path.length - 1];
  if (last === undefined) return;
  let node = target;
  for (const segment of path.slice(0, -1)) {
    const next = node[segment];
    if (next === null || typeof next !== 'object') return;
    node = next as Record<string, unknown>;
  }
  node[last] = value;
}

/**
 * Merges `app_config` rows onto the defaults and validates the whole object.
 *
 * An unknown key is a problem, not something to ignore: a misspelled key that
 * silently does nothing is how a threshold change appears to be applied and is
 * not. Validation runs over the merged result, so a row cannot leave the config
 * in a shape the rest of the system has to defend against.
 */
export function resolveConfig(overrides: ConfigOverrides = {}): ConfigResolution {
  const problems: ConfigProblem[] = [];
  const merged = clone(CONFIG_DEFAULTS) as unknown as Record<string, unknown>;

  for (const [key, value] of Object.entries(overrides)) {
    if (!isConfigKey(key)) {
      problems.push({ kind: 'unknown_key', key });
      continue;
    }
    setAt(merged, key.split('.').map(toCamel), value);
  }

  const parsed = appConfigSchema.safeParse(merged);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      problems.push({
        kind: 'invalid_value',
        key: issue.path.map((p) => toSnake(String(p))).join('.'),
        message: issue.message,
      });
    }
  }

  if (problems.length > 0) return { ok: false, problems };
  // safeParse succeeded, so `parsed.data` is present.
  return { ok: true, config: (parsed as { data: AppConfig }).data };
}

/* -------------------------------------------------------------------------- */
/* Caching                                                                     */
/* -------------------------------------------------------------------------- */

export const CONFIG_CACHE_TTL_MS = 60_000;

/**
 * A 60-second cache (§12) so a hot path does not query `app_config` per request,
 * and a change is picked up without a restart.
 *
 * The clock is injected rather than read, for the same reason it is everywhere
 * else (§3): a test asserts the expiry rather than waiting a minute for it.
 */
export function createConfigCache(
  load: () => Promise<AppConfig>,
  now: () => number,
  ttlMs: number = CONFIG_CACHE_TTL_MS,
): { get: () => Promise<AppConfig>; invalidate: () => void } {
  let cached: { config: AppConfig; loadedAt: number } | undefined;
  let inFlight: Promise<AppConfig> | undefined;

  return {
    async get(): Promise<AppConfig> {
      if (cached !== undefined && now() - cached.loadedAt < ttlMs) return cached.config;
      // One load at a time: a cold cache under concurrent requests should not
      // become N identical queries.
      inFlight ??= load()
        .then((config) => {
          cached = { config, loadedAt: now() };
          return config;
        })
        .finally(() => {
          inFlight = undefined;
        });
      return inFlight;
    },
    invalidate(): void {
      cached = undefined;
    },
  };
}
