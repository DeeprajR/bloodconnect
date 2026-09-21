import type { Metadata } from 'next';
import Link from 'next/link';

import { Card, DataTable, DescList, PageHeader, type Column } from '@blood-connect/ui';

import { KitShell } from '../../kit-shell';
import { notePage } from '@/lib/metrics';
import { requireAccess, useCaseContext } from '@/lib/guards';
import { readDeployment } from '@blood-connect/ops';

export const metadata: Metadata = { title: 'This deployment · Administration' };

export const dynamic = 'force-dynamic';

const stampFormat = new Intl.DateTimeFormat('en-IN', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Asia/Kolkata',
});

const show = (value: unknown): string =>
  typeof value === 'string' ? value : JSON.stringify(value);

type ConfigRow = Awaited<ReturnType<typeof readDeployment>>['config'][number];

/**
 * Which configuration is this deployment actually running (§12).
 *
 * The first question of most incidents. §12 puts clinical thresholds in rows,
 * and a row that overrides a default is invisible from the code: reading the
 * config package tells you the default, not what this database says.
 *
 * Read-only, and that is a rule rather than an omission. Changing a threshold
 * is a clinical decision with its own audited screen, and an operations panel
 * that could quietly move one would be a way to change medical behaviour
 * without anybody reviewing it.
 */
export default async function DeploymentPage() {
  const startedAt = Date.now();
  const actor = await requireAccess('/panel/deployment');
  const ctx = await useCaseContext(actor);
  const deployment = await readDeployment(ctx);

  notePage('/panel/deployment', startedAt);

  const overridden = deployment.config.filter((row) => !row.isDefault);
  const mismatched =
    deployment.storedContractVersion !== null &&
    deployment.storedContractVersion !== deployment.compiledContractVersion;

  const columns: Column<ConfigRow>[] = [
    { key: 'key', header: 'Key', cell: (r) => <span className="font-mono text-xs">{r.key}</span> },
    { key: 'value', header: 'In force', cell: (r) => <span className="tabular-nums">{show(r.value)}</span> },
    { key: 'default', header: 'Default', cell: (r) => <span className="tabular-nums">{show(r.defaultValue)}</span> },
    {
      key: 'source',
      header: 'Source',
      cell: (r) =>
        r.isDefault ? (
          'compiled default'
        ) : (
          <span className="font-medium text-ink">
            this database
            {r.effectiveFrom ? `, from ${stampFormat.format(r.effectiveFrom)}` : ''}
          </span>
        ),
    },
  ];

  return (
    <KitShell currentPath="/panel" currentTitle="This deployment">
      <PageHeader
        title="This deployment"
        description="Read-only. Changing a threshold is a clinical decision, and it happens on its own audited screen."
      />

      {mismatched ? (
        <p
          role="alert"
          className="rounded-control border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger"
        >
          This build compiled against contract {deployment.compiledContractVersion}, and
          the database says {deployment.storedContractVersion}. Ship both releases
          together, or roll the newer one back.
        </p>
      ) : null}

      <Card title="Versions">
        <DescList
          items={[
            { term: 'Contract, compiled', value: deployment.compiledContractVersion },
            {
              term: 'Contract, stored',
              value: deployment.storedContractVersion ?? 'not seeded',
            },
            { term: 'Build', value: deployment.buildId ?? 'not stamped' },
            { term: 'Node', value: deployment.nodeVersion },
            {
              term: 'Migrations applied',
              value: `${String(deployment.migrationsApplied)}${
                deployment.lastMigrationAt
                  ? `, last ${stampFormat.format(deployment.lastMigrationAt)}`
                  : ''
              }`,
            },
          ]}
        />
      </Card>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-ink">Configuration</h2>
        <p className="text-sm text-ink-muted">
          {/*
            Every key, not only the overridden ones. A screen listing three rows
            because three are overridden invites the wrong conclusion: that the
            other forty do not exist, rather than that they sit at their
            defaults.
          */}
          {overridden.length} of {deployment.config.length} values are overridden in this
          database. The rest are the compiled defaults.
        </p>

        <DataTable
          columns={columns}
          rows={[...deployment.config].sort(
            (a, b) => Number(a.isDefault) - Number(b.isDefault) || a.key.localeCompare(b.key),
          )}
          getRowKey={(r) => r.key}
          caption="Resolved configuration, overridden values first"
        />
      </section>

      <Link
        href="/panel"
        className="text-sm font-medium text-ink-muted hover:text-ink hover:underline"
      >
        ← Back to the panel
      </Link>
    </KitShell>
  );
}
