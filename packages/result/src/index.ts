/**
 * Expected failures are values, not exceptions (§11.4).
 *
 * "Tag already assigned" is not exceptional, it is Tuesday. Exceptions stay for
 * bugs and infrastructure faults; everything a use case can foresee comes back
 * as an `Err` carrying a discriminated error, which an adapter maps to an HTTP
 * status or a chat message.
 */

export type Ok<T> = { readonly ok: true; readonly value: T };
export type Err<E> = { readonly ok: false; readonly error: E };
export type Result<T, E> = Ok<T> | Err<E>;

export const ok = <T>(value: T): Ok<T> => ({ ok: true, value });
export const err = <E>(error: E): Err<E> => ({ ok: false, error });

/** Nothing useful to return, but the call can still fail. */
export const okVoid = (): Ok<undefined> => ({ ok: true, value: undefined });

export const isOk = <T, E>(r: Result<T, E>): r is Ok<T> => r.ok;
export const isErr = <T, E>(r: Result<T, E>): r is Err<E> => !r.ok;

export function map<T, U, E>(r: Result<T, E>, f: (value: T) => U): Result<U, E> {
  return r.ok ? ok(f(r.value)) : r;
}

export function mapErr<T, E, F>(r: Result<T, E>, f: (error: E) => F): Result<T, F> {
  return r.ok ? r : err(f(r.error));
}

export function andThen<T, U, E, F>(
  r: Result<T, E>,
  f: (value: T) => Result<U, F>,
): Result<U, E | F> {
  return r.ok ? f(r.value) : r;
}

/** Collects a list of results into a result of a list, failing on the first error. */
export function all<T, E>(results: readonly Result<T, E>[]): Result<T[], E> {
  const values: T[] = [];
  for (const r of results) {
    if (!r.ok) return r;
    values.push(r.value);
  }
  return ok(values);
}

/**
 * Unwrap where the caller has already proven success. A test, or a branch the
 * type system cannot see. Throws, deliberately: reaching it is a bug.
 */
export function unwrap<T, E>(r: Result<T, E>): T {
  if (r.ok) return r.value;
  throw new Error(`unwrap on an Err: ${JSON.stringify(r.error)}`);
}

export function unwrapErr<T, E>(r: Result<T, E>): E {
  if (!r.ok) return r.error;
  throw new Error(`unwrapErr on an Ok: ${JSON.stringify(r.value)}`);
}

/**
 * The shape every use-case error follows: a `kind` to switch on, and a message
 * that is safe to show a human. Anything a specific error needs beyond that it
 * declares itself.
 */
export type AppError<K extends string = string> = {
  readonly kind: K;
  readonly message: string;
};

export const appError = <K extends string>(kind: K, message: string): AppError<K> => ({
  kind,
  message,
});

/**
 * Exhaustiveness guard for error switches. Adding a variant to a union breaks
 * the build at every place that handles it, which is the point of the unions.
 */
export function assertNever(value: never, context = 'unhandled case'): never {
  throw new Error(`${context}: ${JSON.stringify(value)}`);
}
