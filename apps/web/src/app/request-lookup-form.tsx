import { WORDING } from '@blood-connect/domain';

/**
 * Typing the ID the bystander read out (ADR 0010).
 *
 * A plain GET form — no action, no client JavaScript, no state. The result is a
 * URL, so the counter can keep the request open on a second monitor while they
 * work through it, and a reload does not re-submit anything.
 *
 * **The date is prefilled and the sequence is not.** Almost every ID brought to
 * this counter was raised today, so five digits is the whole interaction. The
 * date stays editable because "almost" is not "always" — somebody comes back the
 * next morning with yesterday's slip, and a field they cannot change would send
 * them away.
 */
export function RequestLookupForm({
  datePart,
  defaultValue,
}: {
  /** `DDMMYY` for today. */
  datePart: string;
  defaultValue: string;
}) {
  const [typedDate, typedSequence] = defaultValue.split('-');

  return (
    <form className="app-row" method="get" action="/centre/requests">
      <div className="ux4g-form-group app-stack-tight">
        <label className="ux4g-label-m-strong" htmlFor="lookup-date">
          Date
        </label>
        <input
          className="ux4g-input ux4g-input-lg app-figure app-lookup-date"
          id="lookup-date"
          name="d"
          defaultValue={typedDate ?? datePart}
          inputMode="numeric"
          maxLength={6}
          aria-describedby="lookup-hint"
        />
      </div>

      <div className="ux4g-form-group app-stack-tight">
        <label className="ux4g-label-m-strong" htmlFor="lookup-seq">
          {WORDING.bloodRequest} number
        </label>
        <input
          className="ux4g-input ux4g-input-lg app-figure"
          id="lookup-seq"
          name="n"
          defaultValue={typedSequence ?? ''}
          inputMode="numeric"
          maxLength={5}
          placeholder="00001"
          autoFocus
          required
        />
        <p className="ux4g-label-m-default" id="lookup-hint">
          Five digits, exactly as read out.
        </p>
      </div>

      <button
        type="submit"
        className="ux4g-btn ux4g-btn-primary ux4g-btn-lg app-target"
      >
        Find it
      </button>
    </form>
  );
}
