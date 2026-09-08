/**
 * Seeded staff accounts, one per role (§2.2).
 *
 * §2.2 sanctions the seed path: there is no sign-up page, accounts are
 * provisioned, and until the invite flow lands in phase 5 this script is the
 * only way an account comes into being.
 *
 * **These are synthetic accounts with a published password.** They exist so the
 * four surfaces can be signed into during development and demonstrated. The
 * seed refuses to run against anything that looks like production, because an
 * account with a known password on a real deployment is not a seed, it is a
 * back door.
 */

import { hash } from '@node-rs/argon2';
import { newId } from '@blood-connect/ids';

/** Long enough to satisfy the configured minimum of 12 (§12, §15). */
export const SEED_PASSWORD = 'BloodConnect!Demo2026';

export type AccountSeed = {
  readonly email: string;
  readonly fullName: string;
  readonly role: 'doctor' | 'admin' | 'blood_centre' | 'volunteer_admin';
  readonly provisionalReg: string | null;
  readonly districtScopeId: string | null;
};

/**
 * Names are obviously fictional and the domain is `.invalid`, which RFC 2606
 * reserves precisely so it can never resolve. A seeded identifier must not be
 * able to collide with a real person (§5).
 */
export const ACCOUNT_SEEDS: readonly AccountSeed[] = [
  {
    email: 'doctor@blood-connect.invalid',
    fullName: 'Dr Anita Menon (seed)',
    role: 'doctor',
    provisionalReg: 'TCMC-SEED-00001',
    districtScopeId: null,
  },
  {
    email: 'admin@blood-connect.invalid',
    fullName: 'Ravi Nair (seed)',
    role: 'admin',
    provisionalReg: null,
    districtScopeId: null,
  },
  {
    email: 'centre@blood-connect.invalid',
    fullName: 'Blood Centre Counter (seed)',
    role: 'blood_centre',
    provisionalReg: null,
    districtScopeId: null,
  },
  {
    email: 'volunteer@blood-connect.invalid',
    fullName: 'Sneha Pillai (seed)',
    role: 'volunteer_admin',
    provisionalReg: null,
    // Scoped to Kozhikode, so district scoping is visible rather than theoretical.
    districtScopeId: 'KL_KKD',
  },
];

export type SeededAccount = AccountSeed & {
  readonly id: string;
  readonly passwordHash: string;
  readonly status: 'active';
};

/**
 * Hashes once and reuses it across the four accounts.
 *
 * Argon2id is deliberately slow, and four hashes of the same password would
 * cost four times as much for no security benefit — these are all the same
 * published string, so the hashes carry no independent secret. Real accounts
 * never share a password and never take this path.
 */
export async function buildAccountSeeds(): Promise<SeededAccount[]> {
  const passwordHash = await hash(SEED_PASSWORD);

  return ACCOUNT_SEEDS.map((account) => ({
    ...account,
    id: newId(),
    passwordHash,
    status: 'active' as const,
  }));
}
