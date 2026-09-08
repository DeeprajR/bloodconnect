import { permissionsFor, type Actor, type Permission } from '@/modules/platform';

const PERMISSION_LABELS: Readonly<Record<Permission, string>> = {
  'requests:manage': 'Raise and track blood requests',
  'patients:manage': 'Record patients and admissions',
  'profile:manage': 'Manage your own profile',
  'accounts:manage': 'Provision accounts and work the update queue',
  'centre:operate': 'Answer requests from stock and raise demand',
  'centre:configure': 'Configure the centre and its storage',
  'volunteer:view': 'See where the pressure is',
  'config:write': 'Change clinical thresholds',
};

/**
 * What this account can do, read from the same permission table the route
 * guard, the page guard and the use cases read (§13).
 *
 * It earns its place beyond phase 1: the four roles see genuinely different
 * systems, and "what am I allowed to do here" is the first question someone has
 * on an unfamiliar screen. It is also the fastest way to see the authorization
 * model working end to end.
 */
export function RoleHome({
  actor,
  heading,
  summary,
  next,
}: {
  actor: Actor;
  heading: string;
  summary: string;
  next: readonly string[];
}) {
  const permissions = actor.kind === 'user' ? permissionsFor(actor.role) : [];

  return (
    <>
      <div className="app-stack-tight">
        <h1 className="ux4g-heading-l-strong">{heading}</h1>
        <p className="ux4g-body-m-default">{summary}</p>
      </div>

      <div className="app-grid">
        <section className="ux4g-card ux4g-card-outline" aria-labelledby="permissions-heading">
          <div className="ux4g-card-header">
            <h2 className="ux4g-card-title" id="permissions-heading">
              This account can
            </h2>
          </div>
          <div className="ux4g-card-body">
            <ul className="app-stack-tight">
              {permissions.map((permission) => (
                <li key={permission} className="ux4g-body-s-default">
                  {PERMISSION_LABELS[permission]}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="ux4g-card ux4g-card-outline" aria-labelledby="next-heading">
          <div className="ux4g-card-header">
            <h2 className="ux4g-card-title" id="next-heading">
              Arriving here
            </h2>
            <p className="ux4g-card-sub-title">
              Not built yet. Phase 1 is accounts and access only.
            </p>
          </div>
          <div className="ux4g-card-body">
            <ul className="app-stack-tight">
              {next.map((item) => (
                <li key={item} className="ux4g-body-s-default">
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </section>
      </div>
    </>
  );
}
