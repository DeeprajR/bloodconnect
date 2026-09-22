import type { Metadata } from 'next';
import Link from 'next/link';

import { DataTable, PageHeader, type Column } from '@blood-connect/ui';

import { KitShell } from '../../kit-shell';
import { TraceSearchForm } from './form';
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

type Step = Awaited<ReturnType<typeof trace>>['steps'][number] & { _row: string };

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

  const columns: Column<Step>[] = [
    {
      key: 'when',
      header: 'When',
      cell: (s) => <span className="tabular-nums">{stampFormat.format(s.at)}</span>,
    },
    { key: 'step', header: 'Step', cell: (s) => STAGE_WORDS[s.stage] ?? s.stage },
    { key: 'what', header: 'What happened', cell: (s) => s.detail },
    {
      key: 'record',
      header: 'Record',
      cell: (s) => <span className="break-all text-xs tabular-nums">{s.recordId ?? '–'}</span>,
    },
  ];

  return (
    <KitShell currentPath="/panel" currentTitle="Follow a request">
      <PageHeader
        title="Follow one request"
        description="Paste a request number from the slip, a demand id, or a correlation id from a log line. Reading a trace is recorded in the audit log."
      />

      <TraceSearchForm defaultValue={typed} />

      {result === null ? null : !result.found ? (
        <p
          role="status"
          className="rounded-control border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-ink"
        >
          {result.notes[0]}
        </p>
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={result.steps.map((s, i) => ({ ...s, _row: `${s.stage}-${String(i)}` }))}
            getRowKey={(s) => s._row}
            caption="Every recorded step, oldest first"
          />

          {/*
            The limits, stated on every successful trace rather than only when
            something is missing. An operator has to know what this screen
            cannot see before they conclude that nothing happened.
          */}
          <div className="rounded-control border border-info/30 bg-info-soft px-3 py-2">
            <ul className="list-disc space-y-1 pl-4 text-sm text-ink">
              {result.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </div>
        </>
      )}

      <Link
        href="/panel"
        className="text-sm font-medium text-ink-muted hover:text-ink hover:underline"
      >
        ← Back to the panel
      </Link>
    </KitShell>
  );
}
