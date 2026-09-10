import type { Metadata } from 'next';
import Link from 'next/link';

import { AppShell } from '../../shell';
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

  return (
    <AppShell actor={actor} title="This deployment">
      <div className="app-stack-tight">
        <h1 className="ux4g-heading-l-strong">This deployment</h1>
        <p className="ux4g-body-m-default">
          Read-only. Changing a threshold is a clinical decision, and it happens on its
          own audited screen.
        </p>
      </div>

      {mismatched ? (
        <div className="ux4g-alert ux4g-alert-error" role="alert">
          <div className="ux4g-alert-content">
            <p className="ux4g-alert-message">
              This build compiled against contract {deployment.compiledContractVersion}, and
              the database says {deployment.storedContractVersion}. Ship both releases
              together, or roll the newer one back.
            </p>
          </div>
        </div>
      ) : null}

      <section className="ux4g-card ux4g-card-outline">
        <div className="ux4g-card-header">
          <h2 className="ux4g-card-title">Versions</h2>
        </div>
        <div className="ux4g-card-body">
          <dl className="app-stack-tight">
            <div className="app-row">
              <dt className="ux4g-label-m-strong">Contract, compiled</dt>
              <dd className="ux4g-body-s-default app-figure">
                {deployment.compiledContractVersion}
              </dd>
            </div>
            <div className="app-row">
              <dt className="ux4g-label-m-strong">Contract, stored</dt>
              <dd className="ux4g-body-s-default app-figure">
                {deployment.storedContractVersion ?? 'not seeded'}
              </dd>
            </div>
            <div className="app-row">
              <dt className="ux4g-label-m-strong">Build</dt>
              <dd className="ux4g-body-s-default app-figure">
                {deployment.buildId ?? 'not stamped'}
              </dd>
            </div>
            <div className="app-row">
              <dt className="ux4g-label-m-strong">Node</dt>
              <dd className="ux4g-body-s-default app-figure">{deployment.nodeVersion}</dd>
            </div>
            <div className="app-row">
              <dt className="ux4g-label-m-strong">Migrations applied</dt>
              <dd className="ux4g-body-s-default app-figure">
                {deployment.migrationsApplied}
                {deployment.lastMigrationAt
                  ? `, last ${stampFormat.format(deployment.lastMigrationAt)}`
                  : ''}
              </dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="app-stack-tight">
        <h2 className="ux4g-heading-s-strong">Configuration</h2>
        <p className="ux4g-body-s-default">
          {/*
            Every key, not only the overridden ones. A screen listing three rows
            because three are overridden invites the wrong conclusion: that the
            other forty do not exist, rather than that they sit at their
            defaults.
          */}
          {overridden.length} of {deployment.config.length} values are overridden in this
          database. The rest are the compiled defaults.
        </p>

        <div className="app-scroll-x">
          <table className="ux4g-table">
            <caption className="app-sr-only">
              Resolved configuration, overridden values first
            </caption>
            <thead>
              <tr>
                <th scope="col">Key</th>
                <th scope="col">In force</th>
                <th scope="col">Default</th>
                <th scope="col">Source</th>
              </tr>
            </thead>
            <tbody>
              {[...deployment.config]
                .sort((a, b) => Number(a.isDefault) - Number(b.isDefault) || a.key.localeCompare(b.key))
                .map((row) => (
                  <tr key={row.key}>
                    <th scope="row" className="app-figure">
                      {row.key}
                    </th>
                    <td className="app-figure">{show(row.value)}</td>
                    <td className="app-figure">{show(row.defaultValue)}</td>
                    <td>
                      {row.isDefault ? (
                        'compiled default'
                      ) : (
                        <span className="ux4g-label-m-strong">
                          this database
                          {row.effectiveFrom
                            ? `, from ${stampFormat.format(row.effectiveFrom)}`
                            : ''}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>

      <p className="ux4g-body-s-default">
        <Link href="/panel">Back to the panel</Link>
      </p>
    </AppShell>
  );
}
