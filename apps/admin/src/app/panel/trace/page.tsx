import type { Metadata } from 'next';
import Link from 'next/link';

import { AppShell } from '../../shell';
import { notePage } from '@/lib/metrics';
import { requireAccess, useCaseContext } from '@/lib/guards';
import { trace } from '@blood-connect/ops';

export const metadata: Metadata = { title: 'Follow a request · Administration' };

export const dynamic = 'force-dynamic';

const stampFormat = new Intl.DateTimeFormat('en-IN', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  timeZone: 'Asia/Kolkata',
});

const STAGE_WORDS: Record<string, string> = {
  'request.raised': 'Request raised',
  'request.patient_attached': 'Patient identified',
  'centre.decided': 'Centre decided',
  'centre.issued': 'Bags issued',
  'demand.raised': 'Demand raised',
  'demand.progress': 'Bot picked it up',
  'donor.confirmed': 'Donor confirmed',
  audit: 'Audit',
};

/**
 * Follow one unit of blood end to end (§14).
 *
 * A plain GET form, so the result is a URL an operator can paste into an
 * incident note and somebody else can open. No state, no action, and a reload
 * re-submits nothing.
 *
 * **Every trace is audited by record id.** This screen reaches a blood request,
 * and a blood request identifies a patient, so opening one is a read of a
 * clinical record that whoever did it must be answerable for (§12.2). The audit
 * row is written by the use case, not here, so a second caller cannot skip it.
 */
export default async function TracePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const startedAt = Date.now();
  const actor = await requireAccess('/panel/trace');
  const ctx = await useCaseContext(actor);

  const { q } = await searchParams;
  const typed = q?.trim() ?? '';
  const result = typed.length > 0 ? await trace(ctx, typed) : null;

  notePage('/panel/trace', startedAt);

  return (
    <AppShell actor={actor} title="Follow a request">
      <div className="app-stack-tight">
        <h1 className="ux4g-heading-l-strong">Follow one request</h1>
        <p className="ux4g-body-m-default">
          Paste a request number from the slip, a demand id, or a correlation id from a
          log line. Reading a trace is recorded in the audit log.
        </p>
      </div>

      <form className="app-row" method="get" action="/panel/trace">
        <div className="ux4g-form-group app-stack-tight app-grow">
          <label className="ux4g-label-m-strong" htmlFor="q">
            Identifier
          </label>
          <input
            className="ux4g-input ux4g-input-lg app-figure"
            id="q"
            name="q"
            defaultValue={typed}
            placeholder="090926-00001"
            autoFocus
            required
          />
        </div>
        <button type="submit" className="ux4g-btn ux4g-btn-primary ux4g-btn-lg app-target">
          Follow it
        </button>
      </form>

      {result === null ? null : !result.found ? (
        <div className="ux4g-alert ux4g-alert-warning" role="status">
          <div className="ux4g-alert-content">
            <p className="ux4g-alert-message">{result.notes[0]}</p>
          </div>
        </div>
      ) : (
        <>
          <div className="app-scroll-x">
            <table className="ux4g-table">
              <caption className="app-sr-only">
                Every recorded step, oldest first
              </caption>
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Step</th>
                  <th scope="col">What happened</th>
                  <th scope="col">Record</th>
                </tr>
              </thead>
              <tbody>
                {result.steps.map((step, index) => (
                  <tr key={`${step.stage}-${String(index)}`}>
                    <th scope="row" className="app-figure">
                      {stampFormat.format(step.at)}
                    </th>
                    <td>{STAGE_WORDS[step.stage] ?? step.stage}</td>
                    <td>{step.detail}</td>
                    <td className="app-figure app-trace-id">{step.recordId ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/*
            The limits, stated on every successful trace rather than only when
            something is missing. An operator has to know what this screen
            cannot see before they conclude that nothing happened.
          */}
          <div className="ux4g-alert ux4g-alert-info" role="note">
            <div className="ux4g-alert-content">
              <ul className="app-stack-tight app-plain-list">
                {result.notes.map((note) => (
                  <li className="ux4g-body-s-default" key={note}>
                    {note}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </>
      )}

      <p className="ux4g-body-s-default">
        <Link href="/panel">Back to the panel</Link>
      </p>
    </AppShell>
  );
}
