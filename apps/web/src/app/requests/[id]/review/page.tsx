import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { AppShell } from '../../../shell';
import { SubmitForm } from '../../../hospital-forms';
import { requireAccess, useCaseContext } from '@/lib/guards';
import { getRequest } from '@blood-connect/hospital';
import {
  WORDING,
  bloodGroupLabel,
  productLabel,
  type BloodGroup,
  type Product,
} from '@blood-connect/domain';

export const metadata: Metadata = { title: 'Review · Blood Connect' };

/**
 * The review screen (§3, input-fields).
 *
 * It takes no input beyond a single Submit. Its whole job is to show, in one
 * place, exactly what the blood centre is about to be told — including the
 * patient details that are about to be frozen onto the record. A form that
 * submits straight from the edit screen skips the one moment a doctor has to
 * notice the ward is wrong.
 */
export default async function ReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await requireAccess(`/requests/${id}/review`);
  const ctx = await useCaseContext(actor);

  const row = await getRequest(ctx, id);
  if (!row) notFound();

  // Already submitted: there is nothing to review, and the record is the
  // honest destination.
  if (row.request.status !== 'draft') redirect(`/requests/${id}`);

  const { request, patient, admission } = row;
  const complete =
    Boolean(request.indication?.trim()) &&
    Boolean(request.dateRequired) &&
    Boolean(request.bloodGroup) &&
    Boolean(request.product) &&
    (request.units ?? 0) >= 1;

  return (
    <AppShell actor={actor} title="Review" narrow>
      <div className="app-stack-tight">
        <h1 className="ux4g-heading-l-strong">Check before sending</h1>
        <p className="ux4g-body-m-default">
          This is what the {WORDING.bloodCentre.toLowerCase()} will see. The patient’s
          details are recorded onto the request as they are now.
        </p>
      </div>

      <section className="ux4g-card ux4g-card-outline">
        <div className="ux4g-card-header">
          <h2 className="ux4g-card-title">{patient.name}</h2>
          <p className="ux4g-card-sub-title app-figure">
            {WORDING.ipNumber} {admission.ipNo} · {WORDING.ward} {admission.ward} ·{' '}
            {bloodGroupLabel(patient.bloodGroup as BloodGroup)}
          </p>
        </div>
        <div className="ux4g-card-body">
          <dl className="app-stack-tight">
            <div className="app-row">
              <dt className="ux4g-label-m-strong">{WORDING.product}</dt>
              <dd className="ux4g-body-s-default">
                {request.product ? productLabel(request.product as Product) : '—'}
              </dd>
            </div>
            <div className="app-row">
              <dt className="ux4g-label-m-strong">{WORDING.units}</dt>
              <dd className="ux4g-body-s-default app-figure">{request.units ?? '—'}</dd>
            </div>
            <div className="app-row">
              <dt className="ux4g-label-m-strong">{WORDING.requestedBloodGroup}</dt>
              <dd className="ux4g-body-s-default app-figure">
                {request.bloodGroup ? bloodGroupLabel(request.bloodGroup as BloodGroup) : '—'}
              </dd>
            </div>
            <div className="app-row">
              <dt className="ux4g-label-m-strong">{WORDING.dateRequired}</dt>
              <dd className="ux4g-body-s-default app-figure">
                {request.dateRequired ?? '—'}
              </dd>
            </div>
            <div className="app-stack-tight">
              <dt className="ux4g-label-m-strong">{WORDING.indication}</dt>
              <dd className="ux4g-body-s-default">{request.indication ?? '—'}</dd>
            </div>
          </dl>
        </div>
      </section>

      {complete ? (
        <SubmitForm requestUuid={request.id} />
      ) : (
        <div className="ux4g-alert ux4g-alert-error" role="alert">
          <div className="ux4g-alert-content">
            <p className="ux4g-alert-message">
              Something is still missing. Go back and complete the form.
            </p>
          </div>
        </div>
      )}

      <Link
        className="ux4g-btn ux4g-btn-outline-neutral ux4g-btn-md app-target"
        href={`/requests/${id}`}
      >
        Go back and edit
      </Link>
    </AppShell>
  );
}
