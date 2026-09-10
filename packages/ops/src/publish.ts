/**
 * The web release's own heartbeat (§11.9).
 *
 * The mirror image of what the bot writes. It matters less, because a panel
 * that renders at all was served by the web release, so its liveness is proven
 * by the page you are reading. It is written anyway for two reasons: the
 * contract version each process compiled against is worth recording from both
 * sides, so a mismatched deploy is visible from either one, and a second row
 * makes the heartbeat table a pair rather than a special case.
 */

import { sql } from 'drizzle-orm';
import { CONTRACT_VERSION } from '@blood-connect/contract';
import { processHealth } from '@blood-connect/db';
import { worstLevel, type Alert } from '@blood-connect/domain';
import { platformAlerts, type UseCaseContext } from '@blood-connect/platform';
import { centreAlerts } from '@blood-connect/centre';

export async function publishWebHealth(ctx: UseCaseContext): Promise<readonly Alert[]> {
  const now = ctx.clock.now();

  const alerts = [...(await platformAlerts(ctx)), ...(await centreAlerts(ctx))];
  const worst = worstLevel(alerts);
  const status = worst === 'critical' ? 'degraded' : 'ok';

  await ctx.db
    .insert(processHealth)
    .values({
      process: 'web',
      observedAt: now,
      status,
      contractVersion: CONTRACT_VERSION,
      buildId: process.env['BUILD_ID'] ?? null,
      alerts,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: processHealth.process,
      set: {
        observedAt: now,
        status,
        contractVersion: CONTRACT_VERSION,
        buildId: sql`excluded.build_id`,
        alerts: sql`excluded.alerts`,
        updatedAt: now,
      },
    });

  return alerts;
}
