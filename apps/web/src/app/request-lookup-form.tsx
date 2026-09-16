import { Button, FormField, TextInput } from '@blood-connect/ui';
import { WORDING } from '@blood-connect/domain';

/**
 * Typing the ID the bystander read out (ADR 0010).
 *
 * A plain GET form, no action, no client JavaScript, no state. The
 * result is a URL, so the counter can keep the request open on a second
 * monitor while they work through it, and a reload does not re-submit
 * anything.
 *
 * **The date is prefilled and the sequence is not.** Almost every ID
 * brought to this counter was raised today, so five digits is the whole
 * interaction. The date stays editable because "almost" is not
 * "always", somebody comes back the next morning with yesterday's slip,
 * and a field they cannot change would send them away.
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
    <form
      className="flex flex-wrap items-end gap-3"
      method="get"
      action="/centre/requests"
    >
      <FormField label="Date">
        {(p) => (
          <TextInput
            {...p}
            name="d"
            defaultValue={typedDate ?? datePart}
            inputMode="numeric"
            maxLength={6}
            className="w-24 font-mono tabular-nums text-base tracking-wider"
          />
        )}
      </FormField>

      <FormField
        label={`${WORDING.bloodRequest} number`}
        hint="Five digits, exactly as read out."
      >
        {(p) => (
          <TextInput
            {...p}
            name="n"
            defaultValue={typedSequence ?? ''}
            inputMode="numeric"
            maxLength={5}
            placeholder="00001"
            autoFocus
            required
            className="w-32 font-mono tabular-nums text-base tracking-wider"
          />
        )}
      </FormField>

      <Button type="submit">Find it</Button>
    </form>
  );
}
