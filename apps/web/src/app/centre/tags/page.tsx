import type { Metadata } from 'next';
import Link from 'next/link';

import { CentreShell } from '../../centre-shell';
import {
  DiscrepancyForm,
  RaiseDiscrepancyForm,
  ReleaseTagForm,
  ReturnBagForm,
  TagLookupForm,
} from '../../centre-collision-forms';
import { requireAccess, useCaseContext } from '@/lib/guards';
import { listOpenDiscrepancies, resolveTag, returnTimeLimitMinutes } from '@blood-connect/centre';
import { WORDING, bloodGroupLabel, productLabel } from '@blood-connect/domain';

export const metadata: Metadata = { title: 'Scan a tag · Blood Connect' };

/**
 * §4's three cases, on one screen that offers only the valid actions.
 *
 * "A tag that already exists is not one situation, it is three, and they must
 * not share a button." So the page resolves the tag, shows everything known
 * about the bag on it, and renders exactly one workflow.
 */
export default async function TagsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireAccess('/centre/tags');
  const ctx = await useCaseContext(actor);
  const query = await searchParams;

  const raw = query['tag'];
  const tagUid = typeof raw === 'string' ? raw.trim() : '';

  const [discrepancies, limitMinutes] = await Promise.all([
    listOpenDiscrepancies(ctx),
    returnTimeLimitMinutes(ctx),
  ]);

  const resolved = tagUid === '' ? undefined : await resolveTag(ctx, tagUid);
  const found = resolved?.ok === true ? resolved.value : undefined;

  return (
    <CentreShell actor={actor} title="Scan a tag">
      <div className="app-stack-tight">
        <h1 className="ux4g-heading-l-strong">Scan a tag</h1>
        <p className="ux4g-body-m-default">
          Type or scan the tag identifier. What comes back depends on what the register
          already knows about it.
        </p>
      </div>

      <section className="ux4g-card ux4g-card-outline">
        <div className="ux4g-card-body">
          <TagLookupForm defaultValue={tagUid} />
        </div>
      </section>

      {found ? (
        <section className="ux4g-card ux4g-card-outline">
          <div className="ux4g-card-header">
            <h2 className="ux4g-card-title app-figure">{found.tagUid}</h2>
            {found.bag ? (
              <p className="ux4g-card-sub-title app-figure">
                {found.bag.unitNumber} · {bloodGroupLabel(found.bag.bloodGroup as never)} ·{' '}
                {productLabel(found.bag.product as never)} · {WORDING.expiresOn}{' '}
                {found.bag.expiresAt} · {found.bag.status}
              </p>
            ) : (
              <p className="ux4g-card-sub-title">Nothing is on this tag.</p>
            )}
          </div>

          <div className="ux4g-card-body app-stack">
            {/* ---------------------------------------------- unassigned */}
            {found.resolution.kind === 'unassigned' ? (
              <div className="app-stack-tight">
                <p className="ux4g-body-m-default">
                  This tag is free. Register the bag in your hand against it.
                </p>
                <Link
                  className="ux4g-btn ux4g-btn-primary ux4g-btn-md app-target"
                  href={`/centre/stock/new?tag=${encodeURIComponent(found.tagUid)}`}
                >
                  Register a bag on this tag
                </Link>
              </div>
            ) : null}

            {/* --------------------------------------------- case 1 ----- */}
            {found.resolution.kind === 'return' && found.bag ? (
              <>
                <div className="ux4g-alert ux4g-alert-info" role="status">
                  <div className="ux4g-alert-content">
                    <p className="ux4g-alert-message">
                      {/*
                        Case 1. The register says this unit is out — so it has
                        come back, and that is a return, not a new registration.
                      */}
                      This unit is out of the centre. If it has come back, record the
                      return — do not register it again.
                    </p>
                  </div>
                </div>
                <ReturnBagForm bagId={found.bag.id} limitMinutes={limitMinutes} />
              </>
            ) : null}

            {/* --------------------------------------------- case 2 ----- */}
            {found.resolution.kind === 'reuse' && found.bag ? (
              <>
                <div className="ux4g-alert ux4g-alert-info" role="status">
                  <div className="ux4g-alert-content">
                    <p className="ux4g-alert-message">
                      {/*
                        Two deliberate steps. §4: a single "reassign" button
                        invites somebody to race past what happened to the
                        previous bag.
                      */}
                      The bag on this tag is finished ({found.bag.status}). Release the tag
                      first, then register the new bag through the normal intake form — it
                      is a new record with its own expiry, not an edit of the old one.
                    </p>
                  </div>
                </div>
                <ReleaseTagForm tagUid={found.tagUid} />
              </>
            ) : null}

            {/* --------------------------------------------- case 3 ----- */}
            {found.resolution.kind === 'blocked' && found.bag ? (
              <>
                <div className="ux4g-alert ux4g-alert-error" role="alert">
                  <div className="ux4g-alert-content">
                    <p className="ux4g-alert-message">
                      <strong>Stop.</strong> The register says {found.bag.unitNumber} is on
                      the shelf right now. That means the register is stale, two bags carry
                      this tag, or the tag is cloned — and every one of those can put the
                      wrong unit into a patient.
                    </p>
                    <p className="ux4g-body-s-default">
                      {/*
                        No resolution offered here, by design (§4, §7.5). The
                        pressure to add a "register it anyway" button will come
                        from busy staff, and the answer is no.
                      */}
                      Do not register anything on this tag. Go and find{' '}
                      {found.bag.unitNumber} physically first.
                    </p>
                  </div>
                </div>
                {found.openDiscrepancyId === undefined ? (
                  <RaiseDiscrepancyForm tagUid={found.tagUid} />
                ) : (
                  <p className="ux4g-body-s-default">
                    A discrepancy is already open for this tag. It is in the list below.
                  </p>
                )}
              </>
            ) : null}

            {found.resolution.kind === 'retired' ? (
              <div className="ux4g-alert ux4g-alert-warning" role="status">
                <div className="ux4g-alert-content">
                  <p className="ux4g-alert-message">
                    This tag was retired and can never carry a bag again. Use a fresh one.
                  </p>
                </div>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="ux4g-card ux4g-card-outline" aria-labelledby="discrepancies">
        <div className="ux4g-card-header">
          <h2 className="ux4g-card-title" id="discrepancies">
            Open discrepancies
          </h2>
          <p className="ux4g-card-sub-title">
            {/*
              §4: never auto-resolved by a later scan, never expires, stays here
              until a person closes it. The one alarm in this module worth being
              loud.
            */}
            These never clear themselves. Each closes exactly three ways, and each way
            needs your name and what you found.
          </p>
        </div>
        <div className="ux4g-card-body app-stack">
          {discrepancies.length === 0 ? (
            <p className="ux4g-body-s-default">None open.</p>
          ) : (
            discrepancies.map((row) => (
              <div key={row.id} className="ux4g-card ux4g-card-outline">
                <div className="ux4g-card-header">
                  <h3 className="ux4g-card-title app-figure">{row.tagUid}</h3>
                  <p className="ux4g-card-sub-title">
                    Conflicting unit{' '}
                    <span className="app-figure">{row.conflictingUnitNumber}</span>, which
                    the register says is {row.conflictingStatus}.
                    {row.note ? ` — ${row.note}` : ''}
                  </p>
                </div>
                <div className="ux4g-card-body">
                  <DiscrepancyForm
                    discrepancyId={row.id}
                    unitNumber={row.conflictingUnitNumber}
                  />
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      <Link className="ux4g-btn ux4g-btn-text-neutral ux4g-btn-md" href="/centre">
        Back to the overview
      </Link>
    </CentreShell>
  );
}
