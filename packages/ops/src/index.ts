/**
 * The control panel's only entry point (§11.9, §14).
 *
 * One screen an operator can open at 3am and know, without asking anyone,
 * whether the system is working and which part is not.
 *
 * It is administrator-only and holds **no clinical function**. It can read that
 * a demand is stuck; it cannot answer a request, resolve a quarantine or change
 * a threshold. Every action worth taking from here is a link to the screen that
 * owns it, which is what keeps the panel a way in rather than a second, weaker
 * copy of every other surface.
 *
 * This module is unusual in importing three other modules, and does so
 * deliberately through their entry points: each reports its own alerts, and the
 * panel queries no table that another module owns. §11.2's rule matters most
 * here, because a panel reading everything directly would be the one place the
 * boundary did not hold, and the place holding the widest read of all.
 */

export {
  checkDependencies,
  type Dependency,
  type HealthPorts,
  type HealthTile,
} from './health.js';

export { readBoard, type Board, type Heartbeat } from './board.js';

export {
  pruneSamples,
  recordSample,
  routeMetrics,
  statusBreakdown,
  surfaceMetrics,
  type MetricsContext,
  type RouteMetric,
  type Sample,
  type SurfaceMetric,
} from './metrics.js';

export { trace, type Trace, type TraceStep } from './trace.js';

export { readDeployment, type ConfigRow, type Deployment } from './deployment.js';

export { publishWebHealth } from './publish.js';

export {
  HEALTH_STATUSES,
  PROCESSES,
  SURFACES,
  isSurface,
  type HealthStatus,
  type ProcessName,
  type Surface,
} from './types.js';
