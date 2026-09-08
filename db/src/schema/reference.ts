/**
 * The `reference` schema (§5.8).
 *
 * Owned by the web app's migrations, readable by the bot. This is the stated
 * deviation in §19.2: the spec lists the location hierarchy under the bot's
 * data, but Module 1 (patient district and city), Module 2 (centre settings) and
 * Module 4 (district scoping) all need it, and the alternatives are the web app
 * reading a bot table — forbidden by §11.2 — or two copies of a dataset that
 * must agree for proximity ordering to mean anything.
 */

import { relations, sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const referenceSchema = pgSchema('reference');

/**
 * The four levels a donor's address is resolved to (§5, §7.7). The names are the
 * spec's; `kind` below carries what the place is actually called in Kerala, so a
 * type-ahead can say "Taluk" and "Grama Panchayat" rather than "city" and "town".
 */
export const LOCATION_LEVELS = ['district', 'city', 'town', 'locality'] as const;
export type LocationLevel = (typeof LOCATION_LEVELS)[number];

/**
 * Kerala's own vocabulary, mapped onto the four levels above:
 *
 *   district        → district
 *   taluk           → city
 *   corporation / municipality / grama_panchayat → town
 *   zone            → locality  (corporations only; informal groupings)
 *
 * Recorded rather than inferred, because "Feroke is a municipality, not a
 * panchayat" is the sort of correction the dataset receives and the ordering
 * must not depend on.
 */
export const LOCATION_KINDS = [
  'district',
  'taluk',
  'corporation',
  'municipality',
  'grama_panchayat',
  'zone',
] as const;
export type LocationKind = (typeof LOCATION_KINDS)[number];

/** The hierarchy is seeded **and versioned** (§5). */
export const locationDatasetVersions = referenceSchema.table(
  'location_dataset_versions',
  {
    version: text('version').primaryKey(),
    source: text('source').notNull(),
    notes: text('notes'),
    importedAt: timestamp('imported_at', { withTimezone: true }).notNull().defaultNow(),
  },
);

export const locationNodes = referenceSchema.table(
  'location_nodes',
  {
    /**
     * Dataset-supplied, not a UUID (`KKD_T1_P05`). Donors are stored against
     * this id and never against the display name, so a spelling fix does not
     * break records.
     */
    id: text('id').primaryKey(),
    level: text('level').notNull(),
    kind: text('kind').notNull(),
    parentId: text('parent_id'),
    name: text('name').notNull(),
    /** Lowercased, accent- and punctuation-stripped, for the type-ahead. */
    nameNormalised: text('name_normalised').notNull(),
    datasetVersion: text('dataset_version')
      .notNull()
      .references(() => locationDatasetVersions.version),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Self-referencing hierarchy: district → city → town → locality (§5.8).
    foreignKey({
      columns: [table.parentId],
      foreignColumns: [table.id],
      name: 'location_nodes_parent_id_fk',
    }),
    // Enumerations are text + CHECK rather than Postgres enum types (§5.2):
    // adding a value is a migration either way, but a CHECK changes without a
    // table rewrite and the TypeScript union stays the authority.
    check(
      'location_nodes_level_check',
      sql`level IN ('district', 'city', 'town', 'locality')`,
    ),
    check(
      'location_nodes_kind_check',
      sql`kind IN ('district', 'taluk', 'corporation', 'municipality', 'grama_panchayat', 'zone')`,
    ),
    // Only a district has no parent; every other level must hang off one.
    check(
      'location_nodes_root_check',
      sql`(level = 'district') = (parent_id IS NULL)`,
    ),
    index('location_nodes_parent_name_idx').on(table.parentId, table.nameNormalised),
    index('location_nodes_level_idx').on(table.level),
  ],
);

export const locationNodeRelations = relations(locationNodes, ({ one, many }) => ({
  parent: one(locationNodes, {
    fields: [locationNodes.parentId],
    references: [locationNodes.id],
    relationName: 'children',
  }),
  children: many(locationNodes, { relationName: 'children' }),
  aliases: many(locationAliases),
}));

/**
 * Kerala localities have several romanised spellings each (§5). Matching without
 * aliases fragments the donor pool — Koyilandy and Quilandy are one place, and a
 * wave that treats them as two reaches half the people it should.
 */
export const locationAliases = referenceSchema.table(
  'location_aliases',
  {
    nodeId: text('node_id')
      .notNull()
      .references(() => locationNodes.id, { onDelete: 'cascade' }),
    aliasNormalised: text('alias_normalised').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.nodeId, table.aliasNormalised] }),
    uniqueIndex('location_aliases_alias_node_idx').on(table.aliasNormalised, table.nodeId),
  ],
);

export const locationAliasRelations = relations(locationAliases, ({ one }) => ({
  node: one(locationNodes, {
    fields: [locationAliases.nodeId],
    references: [locationNodes.id],
  }),
}));
