/**
 * The seeded location hierarchy (§5, §5.8).
 *
 * Kozhikode district, down to locality, from `docs/kozhikode.json`. The build
 * plan asks for two or three districts fully populated rather than the whole
 * state: what has to be visible is the wave ordering preferring the nearest
 * tier, and four taluks with sixty-odd local bodies demonstrates that.
 *
 * The dataset maps Kerala's own vocabulary onto the spec's four levels:
 *
 *   district → district · taluk → city · corporation/municipality/panchayat →
 *   town · zone → locality
 *
 * `kind` keeps the real term so a type-ahead can say "Taluk" rather than "City".
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { findUp } from '../src/paths.js';
import type { LocationKind, LocationLevel } from '../src/schema/reference.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/** The dataset, where it was supplied (architecture plan, open question #9). */
export const DATASET_PATH = findUp(path.join('docs', 'kozhikode.json'), here);

export const DATASET_VERSION = 'kerala-kozhikode-2026-09-08';
export const DATASET_SOURCE =
  'Hand-compiled from lsgkerala.gov.in local body listings; corporation zones are informal groupings for donor proximity, not ward divisions.';

type RawZone = { id: string; name: string };
type RawLsgUnit = {
  id: string;
  name: string;
  type: 'corporation' | 'municipality' | 'grama_panchayat';
  zones?: RawZone[];
};
type RawTaluk = { id: string; name: string; lsg_units: RawLsgUnit[] };
type RawDataset = {
  district: { id: string; name: string; state: string; taluks: RawTaluk[] };
};

export type LocationNodeSeed = {
  id: string;
  level: LocationLevel;
  kind: LocationKind;
  parentId: string | null;
  name: string;
  nameNormalised: string;
  aliases: string[];
};

/**
 * Lowercase, strip diacritics and punctuation, collapse whitespace.
 *
 * Malayalam place names are romanised several ways and the type-ahead has to
 * match across them; normalising is the cheap half of that, and
 * `location_aliases` is the half that handles Quilandy vs Koyilandy.
 */
export function normalise(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Well-known alternative romanisations and colonial-era names still in daily
 * use. Not exhaustive, and not meant to be: this list grows from the unmatched
 * free text that lands in `locality_review_queue` (§5.7), which is the only
 * honest source for what people actually type.
 */
const KNOWN_ALIASES: Readonly<Record<string, readonly string[]>> = {
  KL_KKD: ['Calicut'],
  KKD_T1: ['Calicut'],
  KKD_T1_C01: ['Calicut Corporation', 'Kozhikode Corporation'],
  KKD_T3: ['Quilandy', 'Koyilandi'],
  KKD_T3_M01: ['Quilandy', 'Koyilandi'],
  KKD_T4: ['Vadakara', 'Badagara'],
  KKD_T4_M01: ['Vadakara', 'Badagara'],
  KKD_T1_M01: ['Farook'],
  KKD_T2_M02: ['Mukkom'],
};

/** A zone named "City Centre (Palayam / Mananchira)" is also three localities. */
function aliasesFromParenthetical(name: string): string[] {
  const match = /\(([^)]+)\)/.exec(name);
  if (!match?.[1]) return [];
  return match[1]
    .split('/')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function aliasesFor(id: string, name: string): string[] {
  const collected = new Set<string>();
  for (const alias of KNOWN_ALIASES[id] ?? []) collected.add(normalise(alias));
  for (const alias of aliasesFromParenthetical(name)) collected.add(normalise(alias));
  // The bare name before any parenthetical, so "City Centre" matches on its own.
  const bare = name.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
  if (bare && normalise(bare) !== normalise(name)) collected.add(normalise(bare));
  collected.delete(normalise(name));
  return [...collected];
}

const node = (
  id: string,
  level: LocationLevel,
  kind: LocationKind,
  parentId: string | null,
  name: string,
): LocationNodeSeed => ({
  id,
  level,
  kind,
  parentId,
  name,
  nameNormalised: normalise(name),
  aliases: aliasesFor(id, name),
});

/** Flattens the nested dataset into rows, parents before children. */
export async function readLocationSeed(): Promise<LocationNodeSeed[]> {
  const raw = JSON.parse(await readFile(DATASET_PATH, 'utf8')) as RawDataset;
  const { district } = raw;
  const nodes: LocationNodeSeed[] = [
    node(district.id, 'district', 'district', null, district.name),
  ];

  for (const taluk of district.taluks) {
    nodes.push(node(taluk.id, 'city', 'taluk', district.id, taluk.name));

    for (const unit of taluk.lsg_units) {
      nodes.push(node(unit.id, 'town', unit.type, taluk.id, unit.name));

      for (const zone of unit.zones ?? []) {
        nodes.push(node(zone.id, 'locality', 'zone', unit.id, zone.name));
      }
    }
  }

  return nodes;
}
