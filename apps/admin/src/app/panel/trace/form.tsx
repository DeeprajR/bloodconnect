'use client';

import { Button, FormField, TextInput } from '@blood-connect/ui';

/**
 * Just the search field, in its own client boundary.
 *
 * `FormField`'s render-prop `children` is a function, and a Server
 * Component may not pass a function to a `'use client'` boundary
 * (ADR 0015, "Two bugs" §2). `TracePage` itself stays a Server Component
 * so `trace()` and the audit write it triggers run on the server; this
 * is the one piece of the page that needs to cross the boundary.
 */
export function TraceSearchForm({ defaultValue }: { defaultValue: string }) {
  return (
    <form method="get" action="/panel/trace" className="flex flex-wrap items-end gap-3">
      <div className="min-w-0 flex-1">
        <FormField label="Identifier">
          {(p) => (
            <TextInput
              {...p}
              name="q"
              defaultValue={defaultValue}
              placeholder="090926-00001"
              autoFocus
              required
              className="font-mono"
            />
          )}
        </FormField>
      </div>
      <Button type="submit">Follow it</Button>
    </form>
  );
}
