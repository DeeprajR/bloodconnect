import postgres from 'postgres';

/**
 * The database harness.
 *
 * Every test that touches §7 runs against **real Postgres**. `FOR UPDATE SKIP
 * LOCKED`, partial unique indexes and conditional UPDATEs are the mechanisms
 * that make the seven correctness points correct, and none of them exist in an
 * in-memory double. A suite that mocks the database would pass while two staff
 * decide the same request twice.
 */

export type Sql = postgres.Sql<Record<string, unknown>>;

export const SCHEMAS = ['hospital', 'bot', 'reference'] as const;

/**
 * Test connections use the migrator role: a test needs to truncate across
 * schemas, which neither application role is granted. The roles themselves are
 * exercised by the grant tests, which connect as `app_web` and `app_bot` on
 * purpose and assert what they *cannot* do.
 */
export function testDatabaseUrl(): string {
  const url = process.env['TEST_DATABASE_URL'];
  if (!url) {
    throw new Error(
      'TEST_DATABASE_URL is not set. Run `pnpm up` for local Postgres, then copy .env.example to .env.',
    );
  }
  // A guard, not a courtesy: pointing a suite that truncates every table at a
  // database whose name does not say "test" is a mistake worth refusing.
  if (!/test/i.test(url)) {
    throw new Error(
      `refusing to run destructive tests against a database that is not named for testing: ${url.replace(/:\/\/[^@]*@/, '://***@')}`,
    );
  }
  return url;
}

export type TestDatabase = {
  readonly sql: Sql;
  readonly truncateAll: () => Promise<void>;
  readonly close: () => Promise<void>;
};

export function createTestDatabase(options: { max?: number } = {}): TestDatabase {
  // postgres.js reports NOTICEs, "schema already exists" and the like, on
  // stderr by default. They are not errors and they bury a real failure.
  const quiet = { onnotice: () => undefined };

  const sql = postgres(testDatabaseUrl(), { max: options.max ?? 5, ...quiet });

  return {
    sql,
    /**
     * Truncate rather than drop-and-recreate: the schema is what the migrations
     * produced, and a test that quietly rebuilds it would stop testing them.
     * `RESTART IDENTITY` matters because `blood_request_counters` is the thing
     * §7.1 allocates from.
     */
    async truncateAll(): Promise<void> {
      const tables = await sql<{ qualified: string }[]>`
        SELECT format('%I.%I', schemaname, tablename) AS qualified
          FROM pg_tables
         WHERE schemaname = ANY(${sql.array(SCHEMAS as unknown as string[])})
           AND tablename NOT LIKE '\\_\\_drizzle%'
      `;
      if (tables.length === 0) return;
      const list = tables.map((t) => t.qualified).join(', ');
      await sql.unsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
    },
    close: () => sql.end({ timeout: 5 }),
  };
}

/**
 * Runs tasks on genuinely separate connections, at the same time.
 *
 * "Two staff decide the same request" is not reproducible by calling a function
 * twice: both calls would share a connection and serialise politely. Each task
 * here gets its own session, so the lock and the unique constraint are the only
 * things deciding the winner, which is the assertion.
 */
export async function runConcurrently<T>(
  tasks: readonly ((sql: Sql) => Promise<T>)[],
): Promise<PromiseSettledResult<T>[]> {
  const url = testDatabaseUrl();
  const connections = tasks.map(() =>
    postgres(url, { max: 1, onnotice: () => undefined }),
  );
  try {
    return await Promise.allSettled(
      tasks.map((task, index) => task(connections[index] as Sql)),
    );
  } finally {
    await Promise.all(connections.map((c) => c.end({ timeout: 5 })));
  }
}

/** The values from a settled batch that succeeded, usually "exactly one did". */
export const fulfilled = <T>(results: readonly PromiseSettledResult<T>[]): T[] =>
  results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));

export const rejected = <T>(results: readonly PromiseSettledResult<T>[]): unknown[] =>
  results.flatMap((r): unknown[] => (r.status === 'rejected' ? [r.reason] : []));
