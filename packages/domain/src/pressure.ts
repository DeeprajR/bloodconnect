/**
 * How hard a blood group is being pushed right now, as four states (§6).
 *
 * The volunteer dashboard is eight tiles and nothing else, and a volunteer
 * reads it mid-conversation on a phone, deciding which group to point a
 * community at today. So the tile answers one question, *does this group need
 * me?*, and the answer has to be a rule rather than a judgement made in a
 * component, for the same reason the stock bands are.
 *
 * | State        | When                                        | What a volunteer does |
 * |--------------|---------------------------------------------|-----------------------|
 * | `met`        | nothing outstanding, and the shelf is stocked | Nothing. Push another group |
 * | `recruiting` | outstanding, but donors are coming           | Keep it moving |
 * | `short`      | outstanding, and few donors so far           | Post it today |
 * | `critical`   | outstanding, and nobody has confirmed        | Post it now, and ring people |
 *
 * **A group below the stock floor is never `met`.** The shelf running down is
 * the thing donor recruitment exists to prevent, and a green tile over an empty
 * shelf tells a volunteer the opposite of the truth. Where there is no open
 * demand for a group that is under its floor, the tile reads `short`: something
 * to do today, not something to panic about, because no request is waiting on
 * it yet.
 *
 * Per §12 this reads no configuration. The two tunable boundaries arrive as
 * parameters, from `pressure.recruiting_fraction` and `pressure.short_fraction`.
 *
 * Nothing here touches a name, a phone number or a request. §6 is explicit that
 * the volunteer surface is counts and hospitals, and a module that cannot see a
 * person cannot leak one.
 */

export const PRESSURE_LEVELS = ['met', 'recruiting', 'short', 'critical'] as const;
export type PressureLevel = (typeof PRESSURE_LEVELS)[number];

export type PressureInput = {
  /** Units asked for across every open demand for the group. */
  readonly unitsRequired: number;
  /** Units donors have confirmed against those demands. */
  readonly unitsConfirmed: number;
  /** Whether the centre's shelf for the group is under its floor (§4). */
  readonly belowFloor: boolean;
};

export type PressureFractions = {
  readonly recruiting: number;
  readonly short: number;
};

/** Units still to find. Never negative: over-confirmation is not a deficit. */
export function unitsOutstanding(input: PressureInput): number {
  return Math.max(0, input.unitsRequired - input.unitsConfirmed);
}

export function pressureFor(
  input: PressureInput,
  fractions: PressureFractions,
): PressureLevel {
  const outstanding = unitsOutstanding(input);

  // Nothing outstanding. Green only if the shelf agrees.
  if (outstanding === 0) return input.belowFloor ? 'short' : 'met';

  // Everything outstanding and nobody coming. Said apart from the fractions,
  // because zero confirmed is different in kind from few confirmed: there is
  // nobody to thank and nobody to wait for.
  if (input.unitsConfirmed === 0) return 'critical';

  const covered = input.unitsConfirmed / Math.max(1, input.unitsRequired);
  if (covered >= fractions.recruiting) return 'recruiting';
  if (covered >= fractions.short) return 'short';
  return 'critical';
}

/**
 * The word next to the colour.
 *
 * §6 and §11.10 both say colour is never the only signal, so every tile carries
 * this as text. On a cheap phone in daylight it is the part that survives.
 */
export const PRESSURE_LABELS: Readonly<Record<PressureLevel, string>> = {
  met: 'Covered',
  recruiting: 'Donors coming',
  short: 'Needs donors',
  critical: 'Nobody yet',
};

/**
 * What a volunteer pastes into a community group.
 *
 * Generated from the live numbers rather than typed, so it cannot go stale and
 * cannot say anything nobody reviewed (§9). There is deliberately no free-text
 * field anywhere near it.
 *
 * The message names a hospital and a town because that is what makes somebody
 * walk in. It names no patient, no doctor and no donor, because §6 forbids all
 * three on this surface and a message is the one thing here that leaves it.
 */
export type ShareLine = {
  readonly hospitalName: string;
  readonly town: string | null;
  readonly unitsOutstanding: number;
  readonly neededBy: string;
};

export function shareMessageFor(
  group: string,
  lines: readonly ShareLine[],
  where: { readonly boardUrl: string },
): string {
  if (lines.length === 0) {
    return `${group} blood: nothing outstanding right now. Thank you. Please keep the group ready. ${where.boardUrl}`;
  }

  const total = lines.reduce((sum, line) => sum + line.unitsOutstanding, 0);
  const head = `${group} blood needed: ${total} unit${total === 1 ? '' : 's'}.`;

  const body = lines.map((line) => {
    /*
     * A hospital whose name already carries its town does not get it twice.
     * "Government Medical College Blood Centre, Kozhikode, Kozhikode" is what
     * appending it blindly produces, and a volunteer pasting that into a group
     * looks careless on the hospital's behalf.
     */
    const town = line.town;
    const alreadyNamed =
      town === null || line.hospitalName.toLowerCase().includes(town.toLowerCase());
    const where = alreadyNamed ? line.hospitalName : `${line.hospitalName}, ${town}`;
    const units = `${line.unitsOutstanding} unit${line.unitsOutstanding === 1 ? '' : 's'}`;
    return `• ${where}: ${units} by ${line.neededBy}`;
  });

  return [
    head,
    ...body,
    'If you are eligible and free, please go to the hospital blood centre.',
    where.boardUrl,
  ].join('\n');
}
