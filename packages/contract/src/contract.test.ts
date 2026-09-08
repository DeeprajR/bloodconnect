import { describe, expect, it } from 'vitest';

import { DEMAND_STATUSES, demandTransitions as domainDemand } from '@blood-connect/domain';

import {
  CONFIRMATION_STATUSES,
  CONTRACT_VERSION,
  DONOR_DEMAND_COLUMNS,
  DONOR_DEMAND_CONFIRMATION_COLUMNS,
  canBotWrite,
  canBotWriteConfirmation,
  canCentreWrite,
  canCentreWriteConfirmation,
  canWriterMoveConfirmation,
  canWriterMoveDemand,
  checkContractVersion,
  confirmationTransitions,
  demandTransitions,
  donorDemandRowSchema,
  isAwaitingImport,
} from './index.js';

/**
 * §11.2 names a one-sided change to `donor_demand` as the single most likely way
 * this system breaks in production. These are the mechanical checks that make
 * that a build failure rather than a production incident.
 */
describe('column ownership (§7)', () => {
  it('never lets the bot write what the need is', () => {
    // The columns the centre snapshots when it raises the demand. If the bot
    // could move any of these, a donor could be sent to the wrong hospital for
    // the wrong group.
    for (const column of [
      'units',
      'blood_group',
      'product',
      'date_required',
      'hospital_name',
      'hospital_address',
      'trigger',
      'blood_request_id',
    ] as const) {
      expect(canBotWrite(column), column).toBe(false);
      expect(canCentreWrite(column), column).toBe(true);
    }
  });

  it('never lets the centre write recruitment progress', () => {
    for (const column of [
      'confirmed_units',
      'waitlisted_units',
      'completed_units',
      'donors_notified',
      'bot_public_id',
      'imported_at',
    ] as const) {
      expect(canCentreWrite(column), column).toBe(false);
      expect(canBotWrite(column), column).toBe(true);
    }
  });

  it('shares exactly status and updated_at', () => {
    const shared = DONOR_DEMAND_COLUMNS.filter((c) => canBotWrite(c) && canCentreWrite(c));
    expect([...shared].sort()).toEqual(['status', 'updated_at']);
  });

  it('leaves no column unowned', () => {
    const orphans = DONOR_DEMAND_COLUMNS.filter((c) => !canBotWrite(c) && !canCentreWrite(c));
    expect(orphans).toEqual([]);
  });

  it('keeps the counter outcome the centre’s, and the acknowledgement the bot’s', () => {
    for (const column of ['donated_at', 'bag_identifier', 'marked_by'] as const) {
      expect(canCentreWriteConfirmation(column), column).toBe(true);
      expect(canBotWriteConfirmation(column), column).toBe(false);
    }
    expect(canBotWriteConfirmation('acknowledged_at')).toBe(true);
    expect(canCentreWriteConfirmation('acknowledged_at')).toBe(false);
  });

  it('leaves no confirmation column unowned', () => {
    const orphans = DONOR_DEMAND_CONFIRMATION_COLUMNS.filter(
      (c) => !canBotWriteConfirmation(c) && !canCentreWriteConfirmation(c),
    );
    expect(orphans).toEqual([]);
  });

  it('matches the schema, field for field', () => {
    const toSnake = (s: string) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
    const fromSchema = Object.keys(donorDemandRowSchema.shape).map(toSnake).sort();
    expect(fromSchema).toEqual([...DONOR_DEMAND_COLUMNS].sort());
  });
});

describe('transitions, scoped by writer (§7)', () => {
  it('lets only the centre cancel a demand', () => {
    expect(canWriterMoveDemand('centre', 'open', 'cancelled')).toBe(true);
    expect(canWriterMoveDemand('bot', 'open', 'cancelled')).toBe(false);
  });

  it('lets only the bot declare a demand fulfilled, complete or expired', () => {
    expect(canWriterMoveDemand('bot', 'open', 'fulfilled')).toBe(true);
    expect(canWriterMoveDemand('bot', 'fulfilled', 'completed')).toBe(true);
    expect(canWriterMoveDemand('bot', 'open', 'expired')).toBe(true);
    expect(canWriterMoveDemand('centre', 'open', 'fulfilled')).toBe(false);
    expect(canWriterMoveDemand('centre', 'fulfilled', 'completed')).toBe(false);
  });

  it('is exactly the domain machine when both sides are put together', () => {
    // An edge added to one side without being accounted for in the other is
    // what this catches — in either direction.
    for (const from of DEMAND_STATUSES) {
      const union = new Set([...demandTransitions.centre[from], ...demandTransitions.bot[from]]);
      expect([...union].sort(), from).toEqual([...domainDemand[from]].sort());
    }
  });

  it('lets only the centre record what happened at the counter', () => {
    for (const to of ['completed', 'no_show', 'cancelled'] as const) {
      expect(canWriterMoveConfirmation('centre', 'confirmed', to)).toBe(true);
      expect(canWriterMoveConfirmation('bot', 'confirmed', to)).toBe(false);
    }
  });

  it('never reopens a closed confirmation', () => {
    for (const from of CONFIRMATION_STATUSES.filter((s) => s !== 'confirmed')) {
      expect(confirmationTransitions.centre[from]).toEqual([]);
      expect(confirmationTransitions.bot[from]).toEqual([]);
    }
  });
});

describe('the poll the bot runs (§7)', () => {
  it('sees an open demand nobody has imported', () => {
    expect(isAwaitingImport({ status: 'open', botPublicId: null })).toBe(true);
  });

  it('ignores one already imported, and one already closed', () => {
    expect(isAwaitingImport({ status: 'open', botPublicId: 'bp_1' })).toBe(false);
    expect(isAwaitingImport({ status: 'cancelled', botPublicId: null })).toBe(false);
  });
});

describe('versioning (§6)', () => {
  it('accepts an equal or additive version', () => {
    expect(checkContractVersion(CONTRACT_VERSION).ok).toBe(true);
    expect(checkContractVersion('1.4.0').ok).toBe(true);
  });

  it('refuses to start on a major mismatch', () => {
    const result = checkContractVersion('2.0.0');
    expect(result.ok).toBe(false);
    // A refused start beats silent corruption of a table two processes write.
    if (!result.ok) expect(result.expected).toBe(CONTRACT_VERSION);
  });
});
