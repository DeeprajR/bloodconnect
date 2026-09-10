import { describe, expect, it } from 'vitest';

import {
  BAG_STATUSES,
  BLOOD_REQUEST_STATUSES,
  DEMAND_STATUSES,
  DONOR_JOURNEY_STATUSES,
  bagTransitions,
  bloodRequestTransitions,
  canTransition,
  demandTransitions,
  donorJourneyTransitions,
  isDemandClosed,
  isRequestDecided,
  needsStandDown,
  terminalStates,
  type Transitions,
} from './state-machines.js';

/**
 * Every machine gets the same three structural checks, because the failure mode
 * §8 exists to prevent is a flow with an entrance and no exit, and that is
 * visible in the table itself before any code uses it.
 */
function assertWellFormed<S extends string>(
  name: string,
  states: readonly S[],
  table: Transitions<S>,
): void {
  it(`${name}: every state appears in the table exactly once`, () => {
    expect(Object.keys(table).sort()).toEqual([...states].sort());
  });

  it(`${name}: every target is a real state`, () => {
    for (const from of states) {
      for (const to of table[from]) {
        expect(states, `${from} → ${to}`).toContain(to);
      }
    }
  });

  it(`${name}: every state is reachable from the first, or is the first`, () => {
    const start = states[0]!;
    const seen = new Set<S>([start]);
    const queue: S[] = [start];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const next of table[current]) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    expect([...seen].sort()).toEqual([...states].sort());
  });
}

describe('blood request', () => {
  assertWellFormed('blood request', BLOOD_REQUEST_STATUSES, bloodRequestTransitions);

  it('never deletes an abandoned draft. It only moves forward (§8)', () => {
    expect(bloodRequestTransitions.draft).toEqual(['submitted']);
  });

  it('refuses every draft transition once submitted', () => {
    expect(canTransition(bloodRequestTransitions, 'submitted', 'draft')).toBe(false);
  });

  it('ends in exactly two places', () => {
    /**
     * A **decided** request is not a finished one.
     *
     * This pinned four terminal states until the cancel use case was written,
     * which is when the contradiction showed: §3 says cancelling "releases any
     * reserved bags", and bags are only ever reserved *by* a decision. If
     * `approved` were terminal, that sentence could never fire and units would
     * stay held for a patient who has improved, died or been referred.
     */
    expect(terminalStates(bloodRequestTransitions).sort()).toEqual(['cancelled', 'declined']);
  });

  it('lets a decided request still be cancelled, and a declined one not (§3)', () => {
    expect(canTransition(bloodRequestTransitions, 'approved', 'cancelled')).toBe(true);
    expect(canTransition(bloodRequestTransitions, 'partially_approved', 'cancelled')).toBe(true);
    // Nothing is held for a declined request, so there is nothing to release.
    // The ward raises a new one rather than reopening this.
    expect(canTransition(bloodRequestTransitions, 'declined', 'cancelled')).toBe(false);
    // And a draft is left to age, never cancelled (§8).
    expect(canTransition(bloodRequestTransitions, 'draft', 'cancelled')).toBe(false);
  });

  it('does not let a cancelled request be decided afterwards', () => {
    for (const status of ['approved', 'partially_approved', 'declined'] as const) {
      expect(canTransition(bloodRequestTransitions, 'cancelled', status)).toBe(false);
    }
  });

  it('counts only the three decisions as decided', () => {
    expect(BLOOD_REQUEST_STATUSES.filter(isRequestDecided)).toEqual([
      'approved',
      'partially_approved',
      'declined',
    ]);
    // A cancelled request is not a decided one: the centre never answered it.
    expect(isRequestDecided('cancelled')).toBe(false);
  });
});

describe('bag lifecycle', () => {
  assertWellFormed('bag', BAG_STATUSES, bagTransitions);

  it('releases a reserved bag back to the shelf when a request is cancelled', () => {
    expect(canTransition(bagTransitions, 'reserved', 'available')).toBe(true);
  });

  it('never returns an issued bag straight to the shelf', () => {
    // An issued unit comes back through `returned`, where the cold-chain
    // decision is made (§4). Skipping that is how an unsafe unit is restocked.
    expect(canTransition(bagTransitions, 'issued', 'available')).toBe(false);
  });

  it('still requires a disposal route for an expired unit (§12.1)', () => {
    expect(bagTransitions.expired).toEqual(['discarded']);
  });

  it('lets a quarantined unit end exactly two ways', () => {
    expect(bagTransitions.quarantined).toEqual(['available', 'discarded']);
  });

  it('ends only in discarded or lost', () => {
    expect(terminalStates(bagTransitions).sort()).toEqual(['discarded', 'lost']);
  });
});

describe('demand', () => {
  assertWellFormed('demand', DEMAND_STATUSES, demandTransitions);

  it('closes exactly one way of four (§5)', () => {
    expect(terminalStates(demandTransitions).sort()).toEqual([
      'cancelled',
      'completed',
      'expired',
    ]);
    // "fulfilled then completed" is the fourth: a distinct route to `completed`.
    expect(demandTransitions.fulfilled).toContain('completed');
  });

  it('cannot reopen once closed', () => {
    for (const closed of ['completed', 'cancelled', 'expired'] as const) {
      expect(isDemandClosed(closed)).toBe(true);
      expect(canTransition(demandTransitions, closed, 'open')).toBe(false);
    }
  });
});

describe('donor journey', () => {
  assertWellFormed('donor journey', DONOR_JOURNEY_STATUSES, donorJourneyTransitions);

  it('waitlists rather than screening someone for a place that is gone (§5)', () => {
    expect(canTransition(donorJourneyTransitions, 'NOTIFIED', 'REQUEST_FILLED')).toBe(true);
    // And the loser of the last-unit race, who has already screened (§7.3).
    expect(canTransition(donorJourneyTransitions, 'SCREENING', 'REQUEST_FILLED')).toBe(true);
  });

  it('never leaves a waitlisted donor hanging. Promoted or stood down (§5)', () => {
    expect(donorJourneyTransitions.REQUEST_FILLED).toEqual(['CONFIRMED', 'CANCELLED']);
  });

  it('never lets a deferral become a confirmation', () => {
    expect(donorJourneyTransitions.DEFERRED).toEqual([]);
  });

  it('stands down everyone who was told something and is still waiting (§7.6)', () => {
    expect(DONOR_JOURNEY_STATUSES.filter(needsStandDown).sort()).toEqual([
      'ACCEPTED',
      'CONFIRMED',
      'NOTIFIED',
      'REQUEST_FILLED',
      'SCREENING',
    ]);
  });

  it('stands down exactly the non-terminal states, and no terminal one', () => {
    for (const status of DONOR_JOURNEY_STATUSES) {
      const isOpen = donorJourneyTransitions[status].length > 0;
      expect(needsStandDown(status), status).toBe(isOpen);
    }
  });
});
