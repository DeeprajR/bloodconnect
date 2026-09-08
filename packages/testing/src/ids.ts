import { newId, type IdGenerator, type Uuid } from '@blood-connect/ids';

/**
 * An id generator a test can predict.
 *
 * Ids are injected for the same reason the clock is (§3): a use case that writes
 * an audit row and an outbox row referencing the same new id is far easier to
 * assert against when the id is `known` rather than whatever UUIDv7 came out.
 *
 * The generated ids are still real UUIDv7s — a fake that produced `id-1` would
 * pass tests that the database would then reject.
 */
export function createRecordingIds(): IdGenerator & { readonly issued: readonly string[] } {
  const issued: string[] = [];
  return {
    next<B extends string>(): Uuid<B> {
      const id = newId<B>();
      issued.push(id);
      return id;
    },
    get issued(): readonly string[] {
      return issued;
    },
  };
}

/**
 * A generator that hands out a prepared sequence, then falls back to real ids.
 * For the cases where a test needs to name the id it is about to assert on.
 */
export function createScriptedIds(sequence: readonly string[]): IdGenerator {
  let index = 0;
  return {
    next<B extends string>(): Uuid<B> {
      const scripted = sequence[index];
      index += 1;
      return (scripted ?? newId()) as Uuid<B>;
    },
  };
}
