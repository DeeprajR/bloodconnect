import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { CentreShell } from '../../../centre-shell';
import { RosterMarkForm, WalkInForm } from '../../../centre-collision-forms';
import { requireAccess, useCaseContext } from '@/lib/guards';
import { getDemand, listRoster, listWalkIns } from '@blood-connect/centre';
import { WORDING, bloodGroupLabel, productLabel } from '@blood-connect/domain';

export const metadata: Metadata = { title: 'Roster · Blood Connect' };

const OUTCOME_LABELS: Readonly<Record<string, string>> = {
  confirmed: 'Expected',
  completed: 'Donated',
  no_show: 'Did not come',
  cancelled: 'Cancelled',
  waitlisted: 'On the waiting list',
};

/**
 * The counter's roster for one demand (§4, §8.3).
 *
 * It is a **separate page** on purpose. Donor names and phone numbers are the
 * only donor contact details that cross into the centre's half of the database
 * (§2.10), and they belong on the screen where somebody is actually calling a
 * name at a desk — not spread across a list of every demand ever raised.
 */
export default async function RosterPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await requireAccess('/centre/demands');
  const ctx = await useCaseContext(actor);
  const { id } = await params;

  const demand = await getDemand(ctx, id);
  if (!demand) notFound();

  const [roster, walkIns] = await Promise.all([listRoster(ctx, id), listWalkIns(ctx, id)]);
  const expected = roster.filter((row) => row.status === 'confirmed');
  const settled = roster.filter((row) => row.status !== 'confirmed');

  const open = demand.status === 'open' || demand.status === 'fulfilled';

  return (
    <CentreShell actor={actor} title="Roster">
      <div className="app-stack-tight">
        <h1 className="ux4g-heading-l-strong">
          {bloodGroupLabel(demand.bloodGroup as never)} · {productLabel(demand.product as never)}
        </h1>
        <p className="ux4g-body-m-default">
          {demand.units} {demand.units === 1 ? 'unit' : 'units'} wanted by{' '}
          <span className="app-figure">{demand.dateRequired}</span>. {demand.completedUnits}{' '}
          collected from the roster
          {walkIns.length > 0 ? (
            <>
              , and <span className="app-figure">{walkIns.length}</span> from people who
              simply came in
            </>
          ) : null}
          .
        </p>
      </div>

      <section className="ux4g-card ux4g-card-outline" aria-labelledby="expected">
        <div className="ux4g-card-header">
          <h2 className="ux4g-card-title" id="expected">
            Expected at the counter
          </h2>
          <p className="ux4g-card-sub-title">
            {/*
              §4: the counter is the authority on who gave blood. Nothing else
              in the system can tell these three outcomes apart.
            */}
            Mark each person once they have been seen. A no-show frees the place, and the
            bot offers it to whoever is next on the waiting list.
          </p>
        </div>
        <div className="ux4g-card-body app-stack">
          {expected.length === 0 ? (
            <p className="ux4g-body-s-default">Nobody is expected right now.</p>
          ) : (
            expected.map((row) => (
              <div key={row.id} className="ux4g-card ux4g-card-outline">
                <div className="ux4g-card-header">
                  <h3 className="ux4g-card-title">{row.donorName}</h3>
                  <p className="ux4g-card-sub-title app-figure">
                    {row.donorPhone} · {bloodGroupLabel(row.bloodGroup as never)} ·{' '}
                    {row.channel}
                  </p>
                </div>
                <div className="ux4g-card-body app-stack-tight">
                  {!row.acknowledged ? (
                    <p className="ux4g-label-m-default">
                      {/* Nothing has been sent to them yet; do not assume they know. */}
                      The bot has not thanked this donor yet.
                    </p>
                  ) : null}
                  <RosterMarkForm confirmationId={row.id} declaredGroup={row.bloodGroup} />
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      {open ? (
        <section className="ux4g-card ux4g-card-outline" aria-labelledby="walk-in">
          <div className="ux4g-card-header">
            <h2 className="ux4g-card-title" id="walk-in">
              Somebody gave who is not on this list
            </h2>
            <p className="ux4g-card-sub-title">
              {/*
                §4: getting a donor's interval right matters more than tidy
                state. Refusing the record would lose both the unit and the
                donor.
              */}
              Record it anyway. The donation counts towards this demand, and the person
              is credited with having given today.
            </p>
          </div>
          <div className="ux4g-card-body">
            <WalkInForm demandId={demand.id} />
          </div>
        </section>
      ) : null}

      {walkIns.length > 0 ? (
        <section className="ux4g-card ux4g-card-outline" aria-labelledby="walk-ins">
          <div className="ux4g-card-header">
            <h2 className="ux4g-card-title" id="walk-ins">
              Walk-ins
            </h2>
            <p className="ux4g-card-sub-title">
              {/*
                The centre's own record, not a roster row: it holds no INSERT on
                the bot's roster at all (§5.1). The bot reads these and stops
                recruiting for a unit already collected.
              */}
              Recorded here rather than on the roster, because nobody on this list was
              ever asked by the bot. Each one counts against what is still needed.
            </p>
          </div>
          <div className="ux4g-card-body app-scroll-x">
            <table className="ux4g-table">
              <thead>
                <tr>
                  <th scope="col">Donor</th>
                  <th scope="col">Group</th>
                  <th scope="col">{WORDING.unitNumber}</th>
                  <th scope="col">On</th>
                </tr>
              </thead>
              <tbody>
                {walkIns.map((row) => (
                  <tr key={row.id}>
                    <td>{row.donorName}</td>
                    <td className="app-figure">
                      {bloodGroupLabel(row.bloodGroup as never)}
                    </td>
                    <td className="app-figure">{row.bagIdentifier}</td>
                    <td className="app-figure">{row.donatedOn}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {settled.length > 0 ? (
        <section className="ux4g-card ux4g-card-outline" aria-labelledby="settled">
          <div className="ux4g-card-header">
            <h2 className="ux4g-card-title" id="settled">
              Already marked
            </h2>
          </div>
          <div className="ux4g-card-body app-scroll-x">
            <table className="ux4g-table">
              <thead>
                <tr>
                  <th scope="col">Donor</th>
                  <th scope="col">Outcome</th>
                  <th scope="col">{WORDING.unitNumber}</th>
                  <th scope="col">Typed as</th>
                  <th scope="col">On</th>
                </tr>
              </thead>
              <tbody>
                {settled.map((row) => (
                  <tr key={row.id}>
                    <td>{row.donorName}</td>
                    <td>{OUTCOME_LABELS[row.status] ?? row.status}</td>
                    <td className="app-figure">{row.bagIdentifier ?? '—'}</td>
                    <td className="app-figure">
                      {row.donatedBloodGroup === null
                        ? '—'
                        : bloodGroupLabel(row.donatedBloodGroup as never)}
                      {row.donatedBloodGroup !== null &&
                      row.donatedBloodGroup !== row.bloodGroup ? (
                        <span className="ux4g-label-m-default">
                          {' '}
                          (told us {bloodGroupLabel(row.bloodGroup as never)})
                        </span>
                      ) : null}
                    </td>
                    <td className="app-figure">{row.donatedAt ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <Link className="ux4g-btn ux4g-btn-text-neutral ux4g-btn-md" href="/centre/demands">
        Back to demand
      </Link>
    </CentreShell>
  );
}
