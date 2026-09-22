import type { Metadata } from 'next';
import Link from 'next/link';

import {
  Button,
  Card,
  DataTable,
  PageHeader,
  StatusBadge,
  type Column,
} from '@blood-connect/ui';

import { CentreShell } from '../../centre-shell';
import { LiveRefresh } from '../../volunteer/live';
import { requireAccess, useCaseContext } from '@/lib/guards';
import { stockByGroup } from '@blood-connect/centre';
import {
  findRequestByNumber,
  listRequestsAwaitingDecision,
} from '@blood-connect/hospital';
import { requestDatePart } from '@blood-connect/domain';
import { RequestLookupForm } from '../../request-lookup-form';
import {
  URGENCY_SHORT,
  WORDING,
  bloodGroupLabel,
  isPastResponseTarget,
  isUrgency,
  minutesWaiting,
  productLabel,
  waitingLabel,
  type Urgency,
} from '@blood-connect/domain';

export const metadata: Metadata = { title: 'Request queue · Blood Connect' };

type QueueRow = Awaited<
  ReturnType<typeof listRequestsAwaitingDecision>
>[number];

/**
 * The queue (§4).
 *
 * Ordered by the day the blood is needed, so the oldest need is at the
 * top and an overdue request cannot be buried under newer ones, and
 * every row carries the stock on hand for its group, because the whole
 * question a counter is answering is "can I fill this".
 *
 * The patient details are the frozen snapshot (§2.6), not the live
 * record. That is what the doctor told the centre, and it is what the
 * centre answers.
 */
export default async function QueuePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireAccess('/centre/requests');
  const ctx = await useCaseContext(actor);
  const query = await searchParams;

  const [queue, stock] = await Promise.all([
    listRequestsAwaitingDecision(ctx),
    stockByGroup(ctx),
  ]);

  /**
   * The bystander read out an ID and the counter typed it (ADR 0010).
   *
   * A GET rather than an action, so the result is a URL somebody can
   * keep open on a second monitor while they work through the request.
   */
  const one = (key: string): string =>
    typeof query[key] === 'string' ? query[key].trim() : '';
  // Two fields, one identifier: the date is prefilled and the sequence
  // is what gets typed, so they arrive apart and are joined here.
  const typed = one('n') === '' ? '' : `${one('d')}-${one('n')}`;
  const found = typed === '' ? undefined : await findRequestByNumber(ctx, typed);

  const today = ctx.clock.today();
  const now = ctx.clock.now();
  const thresholds = ctx.config.request.responseMinutes;
  const onShelf = new Map(stock.map((row) => [row.bloodGroup, row.onShelf]));
  const needPatient = queue.filter((row) => row.awaitingPatient).length;

  const columns: Column<QueueRow>[] = [
    {
      key: 'requestId',
      header: 'Request ID',
      cell: (r) => (
        <Link
          href={`/centre/requests/${r.id}`}
          className="font-mono tabular-nums text-primary hover:underline"
        >
          {r.requestId}
        </Link>
      ),
    },
    {
      key: 'urgency',
      header: 'Urgency',
      cell: (r) => {
        const urgency = isUrgency(r.urgency ?? '')
          ? (r.urgency as Urgency)
          : undefined;
        return urgency ? URGENCY_SHORT[urgency] : '—';
      },
    },
    {
      key: 'waiting',
      header: 'Waiting',
      cell: (r) => {
        const urgency = isUrgency(r.urgency ?? '')
          ? (r.urgency as Urgency)
          : undefined;
        /**
         * The clock the top three urgencies actually run on.
         *
         * `date_required` cannot express "within fifteen minutes", so
         * an unanswered emergency would not be flagged until midnight.
         */
        const late =
          urgency !== undefined &&
          isPastResponseTarget(urgency, r.submittedAt, now, thresholds);
        return (
          <span className="inline-flex items-center gap-1.5">
            <span className="tabular-nums">
              {waitingLabel(minutesWaiting(r.submittedAt, now))}
            </span>
            {late ? <StatusBadge label="Late" tone="danger" /> : null}
          </span>
        );
      },
    },
    {
      key: 'patient',
      header: 'Patient',
      cell: (r) =>
        r.awaitingPatient ? (
          <span className="italic text-ink-subtle">no patient yet</span>
        ) : (
          (r.patient.name ?? '—')
        ),
    },
    {
      key: 'wanted',
      header: 'Wanted',
      cell: (r) => (
        <span>
          <span className="tabular-nums">{r.units}</span> ×{' '}
          {productLabel(r.product)}{' '}
          <span className="font-mono tabular-nums">
            {bloodGroupLabel(r.bloodGroup)}
          </span>
        </span>
      ),
    },
    {
      key: 'dateRequired',
      header: WORDING.dateRequired,
      cell: (r) => {
        const overdue = r.dateRequired < today;
        return (
          <span className="inline-flex items-center gap-1.5">
            <span className="font-mono tabular-nums">{r.dateRequired}</span>
            {overdue ? <StatusBadge label="Overdue" tone="danger" /> : null}
          </span>
        );
      },
    },
    {
      key: 'stock',
      header: 'Group stock',
      cell: (r) => (
        <span className="font-mono tabular-nums">
          {onShelf.get(r.bloodGroup) ?? 0}
        </span>
      ),
    },
    {
      key: 'action',
      header: '',
      cell: (r) => (
        <Link
          href={`/centre/requests/${r.id}`}
          className="inline-flex h-8 items-center rounded-control border border-primary/50 bg-surface px-3 text-xs font-medium text-primary hover:bg-primary-soft no-underline"
        >
          {r.awaitingPatient ? 'Take details' : 'Answer'}
        </Link>
      ),
    },
  ];

  return (
    <CentreShell actor={actor} title="Blood requests" current="requests">
      {/*
        The queue answers itself while somebody watches it. `router.refresh()`
        re-runs this page and swaps the rows in place, so a counter reading the
        list does not lose their place and a request raised on a ward appears
        without anybody pressing anything.
      */}
      <LiveRefresh everySeconds={30} />

      <PageHeader
        title="Requests awaiting an answer"
        description={
          // Urgency first, not date: three of the four levels mean
          // today, so a date could not tell an emergency from a
          // routine request (ADR 0010).
          'Most urgent first, then longest waiting. The stock column is red cells and whole blood held for that group, which is not the same as units of the exact component asked for. Open a request to see that.'
        }
      />

      <Card title="Somebody is here with an ID">
        <p className="mb-4 text-xs text-ink-subtle">
          {/*
            The date is prefilled because almost every request brought to
            the counter was raised today, leaving five digits to type
            (ADR 0010).
          */}
          Type the five digits they read out. Today&rsquo;s date is filled in.
        </p>

        <RequestLookupForm
          datePart={requestDatePart(today)}
          defaultValue={typed}
        />

        {typed !== '' && !found ? (
          <div
            role="status"
            className="mt-4 rounded-control border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-ink"
          >
            {/*
              No guessing at a near miss: a wrong digit is a different
              request, not this one. There is a person standing there
              who can read it again.
            */}
            No request with that ID. Ask them to read it again, every
            digit matters.
          </div>
        ) : null}

        {found ? (
          <div
            role="status"
            className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-control border border-info/30 bg-info-soft px-3 py-2 text-sm text-ink"
          >
            <span className="font-mono tabular-nums">
              {found.requestId}: {found.units} × {productLabel(found.product)}{' '}
              {bloodGroupLabel(found.bloodGroup)}
            </span>
            <Link href={`/centre/requests/${found.id}`}>
              <Button size="sm">
                {found.awaitingPatient ? 'Take their details' : 'Open it'}
              </Button>
            </Link>
          </div>
        ) : null}
      </Card>

      {needPatient > 0 ? (
        <div
          role="status"
          className="rounded-control border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-ink"
        >
          {/*
            The counter's own work, surfaced rather than discovered one
            row at a time. A unit has to be traceable to a named
            person (§4).
          */}
          <span className="font-medium text-warning">
            {needPatient}
          </span>{' '}
          {needPatient === 1 ? 'request has' : 'requests have'} no patient
          yet. Take the details from the bystander before issuing.
        </div>
      ) : null}

      <Card>
        {queue.length === 0 ? (
          <p className="text-sm text-ink-muted">
            Nothing waiting. Every submitted request has been answered.
          </p>
        ) : (
          <DataTable columns={columns} rows={queue} getRowKey={(r) => r.id} />
        )}
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
