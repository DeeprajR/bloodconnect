import { defineConfig } from 'vitest/config';
import path from 'node:path';

const pkg = (name: string): string =>
  path.resolve(import.meta.dirname, `packages/${name}/src/index.ts`);

/**
 * Tests run against the packages' **source**, not their build output, so a
 * failing test points at the file you would edit. The published entry point is
 * still what is aliased, so nothing in a test can reach past a package boundary
 * that production code could not (§11.2).
 */
export default defineConfig({
  resolve: {
    alias: {
      '@blood-connect/result': pkg('result'),
      '@blood-connect/ids': pkg('ids'),
      '@blood-connect/domain': pkg('domain'),
      '@blood-connect/config': pkg('config'),
      '@blood-connect/contract': pkg('contract'),
      '@blood-connect/testing': pkg('testing'),
    },
  },
  test: {
    include: ['{packages,db,apps}/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    environment: 'node',
    // Real Postgres, one file at a time: two suites truncating the same tables
    // at once is not the race we are testing (§17). The races that matter are
    // set up deliberately, with `runConcurrently` from packages/testing.
    fileParallelism: false,
    // Brings the test database up to the current migrations before anything
    // runs, and reports that the database suites are skipping when there is no
    // TEST_DATABASE_URL.
    globalSetup: ['./db/vitest.setup.ts'],
  },
});
