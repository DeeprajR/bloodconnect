import type { Metadata } from 'next';
import Link from 'next/link';
import { after } from 'next/server';

import { PageHeader, linkButtonClasses } from '@blood-connect/ui';

import { KitShell } from '../kit-shell';
import { AlertRows } from './alert-rows';
import { HealthTiles } from './health-tiles';
import { MetricsTables } from './metrics-tables';
import { notePage } from '@/lib/metrics';
import { requireAccess, useCaseContext } from '@/lib/guards';
import {
  checkDependencies,
  publishWebHealth,
  readBoard,
  routeMetrics,
  statusBreakdown,
  surfaceMetrics,
} from '@blood-connect/ops';
import { s3Storage, smtpEmailPort } from '@blood-connect/platform';

export const metadata: Metadata = { title: 'Control panel · Administration' };

/** A health screen must never be served from a cache. */
export const dynamic = 'force-dynamic';

const timeFormat = new Intl.DateTimeFormat('en-IN', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  timeZone: 'Asia/Kolkata',
});

/**
 * One screen an operator can open at 3am (§11.9, §14).
 *
 * Ordered by what somebody woken up needs, in the order they need it: is
 * anything broken, is anything waiting, is anything slow, and what is this
 * deployment actually running. Each section says what to do rather than only
 * what is wrong.
 *
 * It holds no clinical function. Every action worth taking from here is a link
 * to the screen that owns it, which is what keeps this a way in rather than a
 * second, weaker copy of every other surface.
 */
export default async function PanelPage() {
  const startedAt = Date.now();
  const actor = await requireAccess('/panel');
  const ctx = await useCaseContext(actor);

  /*
   * The real adapters, so the tiles check the real thing.
   *
   * A panel wired to the in-memory stand-ins would be green on a deployment
   * whose SMTP credentials had expired, which is precisely the outage it exists
   * to catch. Where a real adapter is not configured the tile says so, rather
   * than a fake one answering for it.
   */
  const ports = { email: smtpEmailPort, storage: s3Storage };

  const [tiles, board, surfaces, routes, statuses] = await Promise.all([
    checkDependencies(ctx, ports),
    readBoard(ctx),
    surfaceMetrics(ctx),
    routeMetrics(ctx),
    statusBreakdown(ctx),
  ]);

  notePage('/panel', startedAt);

  /*
   * The web release's own heartbeat, written from the one page guaranteed to
   * be opened when somebody wants to know whether this deployment is alive.
   *
   * There is no ticker on this side to hang it from, and a cron job would be a
   * second thing to keep running. The row matters less than the bot's, because
   * a panel that rendered was served by the web release, but the contract
   * version is worth recording from both sides so a mismatched deploy is
   * visible from either one.
   */
  // The context is built here rather than inside the callback: it reads request
  // headers for §14's metadata, and `after()` runs once the request is gone.
  after(async () => {
    await publishWebHealth(ctx);
  });

  const now = ctx.clock.now();

  return (
    <KitShell currentPath="/panel" currentTitle="Control panel">
      <PageHeader
        title="Control panel"
        description={`Checked at ${timeFormat.format(now)}. This screen reads. It cannot answer a request, resolve a quarantine or change a threshold.`}
        actions={
          <Link href="/panel/trace" className={linkButtonClasses({ variant: 'secondary' })}>
            Follow one request
          </Link>
        }
      />

      <section className="space-y-3" aria-label="Dependencies">
        <h2 className="text-sm font-semibold text-ink">Dependencies</h2>
        <HealthTiles tiles={tiles} heartbeats={board.heartbeats} />
      </section>

      <section className="space-y-3" aria-label="What is waiting">
        <h2 className="text-sm font-semibold text-ink">What is waiting on somebody</h2>
        <AlertRows alerts={board.alerts} gaps={board.gaps} />
      </section>

      <section className="space-y-3" aria-label="Traffic">
        <h2 className="text-sm font-semibold text-ink">Traffic, last 24 hours</h2>
        <MetricsTables surfaces={surfaces} routes={routes} statuses={statuses} />
      </section>

      <section className="space-y-1.5">
        <h2 className="text-sm font-semibold text-ink">This deployment</h2>
        <p className="text-sm text-ink-muted">
          Which configuration is actually in force, and which migrations this
          database has.{' '}
          <Link href="/panel/deployment" className="font-medium text-primary hover:underline">
            Open the deployment view
          </Link>
          .
        </p>
      </section>
    </KitShell>
  );
}
