import type { Metadata } from 'next';
import Link from 'next/link';

import { Card, PageHeader, linkButtonClasses } from '@blood-connect/ui';

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

const LINK_PRIMARY = linkButtonClasses({ variant: 'primary' });

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
    <CentreShell actor={actor} title="Scan a tag" currentPath="/centre/tags">
      <PageHeader
        title="Scan a tag"
        description="Type or scan the tag identifier. What comes back depends on what the register already knows about it."
      />

      <Card>
        <TagLookupForm defaultValue={tagUid} />
      </Card>

      {found ? (
        <Card title={found.tagUid}>
          <div className="space-y-4">
            {found.bag ? (
              <p className="text-sm text-ink-muted">
                {found.bag.unitNumber} ·{' '}
                {bloodGroupLabel(found.bag.bloodGroup as never)} ·{' '}
                {productLabel(found.bag.product as never)} ·{' '}
                {WORDING.expiresOn}{' '}
                <span className="tabular-nums">{found.bag.expiresAt}</span> ·{' '}
                {found.bag.status}
              </p>
            ) : (
              <p className="text-sm text-ink-muted">Nothing is on this tag.</p>
            )}

            {/* ---------------------------------------------- unassigned */}
            {found.resolution.kind === 'unassigned' ? (
              <div className="space-y-3">
                <p className="text-sm text-ink">
                  This tag is free. Register the bag in your hand against it.
                </p>
                <Link
                  href={`/centre/stock/new?tag=${encodeURIComponent(found.tagUid)}`}
                  className={LINK_PRIMARY}
                >
                  Register a bag on this tag
                </Link>
              </div>
            ) : null}

            {/* --------------------------------------------- case 1 ----- */}
            {found.resolution.kind === 'return' && found.bag ? (
              <div className="space-y-3">
                <p
                  role="status"
                  className="rounded-control border border-info/30 bg-info-soft px-3 py-2 text-sm text-ink"
                >
                  {/*
                    Case 1: the register says this unit is out, so it has
                    come back, and that is a return, not a new registration.
                  */}
                  This unit is out of the centre. If it has come back, record
                  the return. Do not register it again.
                </p>
                <ReturnBagForm bagId={found.bag.id} limitMinutes={limitMinutes} />
              </div>
            ) : null}

            {/* --------------------------------------------- case 2 ----- */}
            {found.resolution.kind === 'reuse' && found.bag ? (
              <div className="space-y-3">
                <p
                  role="status"
                  className="rounded-control border border-info/30 bg-info-soft px-3 py-2 text-sm text-ink"
                >
                  {/*
                    Two deliberate steps. §4: a single "reassign" button
                    invites somebody to race past what happened to the
                    previous bag.
                  */}
                  The bag on this tag is finished ({found.bag.status}). Release
                  the tag first, then register the new bag through the normal
                  intake form. It is a new record with its own expiry, not an
                  edit of the old one.
                </p>
                <ReleaseTagForm tagUid={found.tagUid} />
              </div>
            ) : null}

            {/* --------------------------------------------- case 3 ----- */}
            {found.resolution.kind === 'blocked' && found.bag ? (
              <div className="space-y-3">
                <div
                  role="alert"
                  className="space-y-1 rounded-control border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-ink"
                >
                  <p>
                    <strong className="text-danger">Stop.</strong> The register
                    says {found.bag.unitNumber} is on the shelf right now. That
                    means the register is stale, two bags carry this tag, or
                    the tag is cloned, and every one of those can put the
                    wrong unit into a patient.
                  </p>
                  <p className="text-ink-muted">
                    {/*
                      No resolution offered here, by design (§4, §7.5). The
                      pressure to add a "register it anyway" button will come
                      from busy staff, and the answer is no.
                    */}
                    Do not register anything on this tag. Go and find{' '}
                    {found.bag.unitNumber} physically first.
                  </p>
                </div>
                {found.openDiscrepancyId === undefined ? (
                  <RaiseDiscrepancyForm tagUid={found.tagUid} />
                ) : (
                  <p className="text-sm text-ink-muted">
                    A discrepancy is already open for this tag. It is in the
                    list below.
                  </p>
                )}
              </div>
            ) : null}

            {found.resolution.kind === 'retired' ? (
              <p
                role="status"
                className="rounded-control border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-ink"
              >
                This tag was retired and can never carry a bag again. Use a
                fresh one.
              </p>
            ) : null}
          </div>
        </Card>
      ) : null}

      <Card title="Open discrepancies">
        <div className="space-y-4">
          <p className="text-sm text-ink-muted">
            {/*
              §4: never auto-resolved by a later scan, never expires, stays here
              until a person closes it. The one alarm in this module worth being
              loud.
            */}
            These never clear themselves. Each closes exactly three ways, and
            each way needs your name and what you found.
          </p>

          {discrepancies.length === 0 ? (
            <p className="text-sm text-ink-muted">None open.</p>
          ) : (
            <div className="space-y-4">
              {discrepancies.map((row) => (
                <Card key={row.id} title={row.tagUid} className="shadow-none">
                  <div className="space-y-3">
                    <p className="text-sm text-ink-muted">
                      Conflicting unit{' '}
                      <span className="tabular-nums">
                        {row.conflictingUnitNumber}
                      </span>
                      , which the register says is {row.conflictingStatus}.
                      {row.note ? `: ${row.note}` : ''}
                    </p>
                    <DiscrepancyForm
                      discrepancyId={row.id}
                      unitNumber={row.conflictingUnitNumber}
                    />
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      </Card>

      <div>
        <Link
          href="/centre"
          className="text-sm font-medium text-ink-muted hover:text-ink hover:underline"
        >
          ← Back to the overview
        </Link>
      </div>
    </CentreShell>
  );
}
