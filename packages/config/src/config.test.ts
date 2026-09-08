import { describe, expect, it } from 'vitest';

import {
  CONFIG_DEFAULTS,
  CONFIG_KEYS,
  createConfigCache,
  defaultFor,
  resolveConfig,
  type AppConfig,
} from './index.js';

describe('defaults (§12)', () => {
  it('validates against its own schema', () => {
    const resolved = resolveConfig();
    expect(resolved.ok).toBe(true);
    if (resolved.ok) expect(resolved.config).toEqual(CONFIG_DEFAULTS);
  });

  it('exposes every threshold under the dotted key §12 names', () => {
    for (const key of [
      'donor.min_age',
      'donor.max_age',
      'donor.min_weight_kg',
      'donor.interval_days.male',
      'donor.interval_days.female',
      'wave.size',
      'wave.interval_minutes',
      'wave.max_waves',
      'vision.confidence_threshold',
      'vision.shadow_mode',
      'auth.otp_ttl_minutes',
      'auth.min_password_length',
      'ageing.quarantine_days',
      'retention.frames_days',
      'flag.vision_enabled',
    ]) {
      expect(CONFIG_KEYS, key).toContain(key);
    }
  });

  it('holds neither shelf lives nor the stock floor (§12)', () => {
    // Those are edited on the centre settings screen and live in
    // `product_shelf_lives` and `centre_settings`; app_config holds what has no
    // screen. Two homes for one threshold is how they diverge.
    expect(CONFIG_KEYS.some((k) => k.includes('shelf_life'))).toBe(false);
    expect(CONFIG_KEYS.some((k) => k.includes('min_units_per_group'))).toBe(false);
  });

  it('starts vision in shadow mode with the feature off (§4, §14)', () => {
    expect(defaultFor('vision.shadow_mode')).toBe(true);
    expect(defaultFor('flag.vision_enabled')).toBe(false);
  });

  it('starts every feature flag off (§11.2)', () => {
    expect(Object.values(CONFIG_DEFAULTS.flag).every((v) => !v)).toBe(true);
  });

  it('uses the national guideline intervals, with the longer one for other', () => {
    expect(defaultFor('donor.interval_days.male')).toBe(90);
    expect(defaultFor('donor.interval_days.female')).toBe(120);
    expect(defaultFor('donor.interval_days.other')).toBe(120);
  });
});

describe('resolution', () => {
  it('applies a row over the default', () => {
    const resolved = resolveConfig({ 'donor.interval_days.male': 100 });
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.config.donor.intervalDays.male).toBe(100);
      // And leaves everything else alone.
      expect(resolved.config.donor.intervalDays.female).toBe(120);
    }
  });

  it('reports a misspelled key instead of ignoring it', () => {
    // A key that silently does nothing is how a threshold change appears to be
    // applied and is not.
    const resolved = resolveConfig({ 'donor.interval_days.men': 100 });
    expect(resolved.ok).toBe(false);
    if (!resolved.ok) {
      expect(resolved.problems).toEqual([
        { kind: 'unknown_key', key: 'donor.interval_days.men' },
      ]);
    }
  });

  it('rejects a value the schema will not have', () => {
    const resolved = resolveConfig({ 'donor.min_age': -1 });
    expect(resolved.ok).toBe(false);
    if (!resolved.ok) {
      expect(resolved.problems[0]?.kind).toBe('invalid_value');
      expect(resolved.problems[0]?.key).toBe('donor.min_age');
    }
  });

  it('keeps wave.max_waves nullable, because unbounded is the default (§12)', () => {
    const resolved = resolveConfig({ 'wave.max_waves': null });
    expect(resolved.ok).toBe(true);
    const bounded = resolveConfig({ 'wave.max_waves': 3 });
    expect(bounded.ok).toBe(true);
  });
});

describe('the cache (§12)', () => {
  const config = CONFIG_DEFAULTS;

  it('serves from memory inside the ttl and reloads after it', async () => {
    let now = 0;
    let loads = 0;
    const cache = createConfigCache(
      () => {
        loads += 1;
        return Promise.resolve(config);
      },
      () => now,
      60_000,
    );

    await cache.get();
    await cache.get();
    expect(loads).toBe(1);

    now = 59_999;
    await cache.get();
    expect(loads).toBe(1);

    now = 60_000;
    await cache.get();
    expect(loads).toBe(2);
  });

  it('collapses a cold-cache stampede into one load', async () => {
    let loads = 0;
    const cache = createConfigCache(
      async () => {
        loads += 1;
        await Promise.resolve();
        return config;
      },
      () => 0,
    );

    await Promise.all([cache.get(), cache.get(), cache.get()]);
    expect(loads).toBe(1);
  });

  it('reloads immediately after a change invalidates it', async () => {
    let current: AppConfig = config;
    let loads = 0;
    const cache = createConfigCache(
      () => {
        loads += 1;
        return Promise.resolve(current);
      },
      () => 0,
    );

    await cache.get();
    current = { ...config, wave: { ...config.wave, size: 5 } };
    cache.invalidate();

    expect((await cache.get()).wave.size).toBe(5);
    expect(loads).toBe(2);
  });
});
