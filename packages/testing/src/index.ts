/**
 * Test doubles and harnesses (§17).
 *
 * Two things this package exists for, both named in the plan:
 *
 *  - **A fake clock**, because every use case takes its time from an injected
 *    port (§3). Freezing a global would make "one day either side of the
 *    inter-donation interval" a test that passes on the wrong day of the month.
 *  - **A database harness against real Postgres**, because the seven places
 *    correctness is decided (§7) are `FOR UPDATE SKIP LOCKED`, partial unique
 *    indexes and conditional UPDATEs. None of those exist in an in-memory fake,
 *    so a suite that mocks the database proves nothing about them.
 */

export * from './clock.js';
export * from './database.js';
export * from './ids.js';
