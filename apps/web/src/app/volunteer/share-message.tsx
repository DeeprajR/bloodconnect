'use client';

import { useState } from 'react';

import { Button } from '@blood-connect/ui';

/**
 * The message a volunteer pastes into a community group (§6).
 *
 * The text is generated on the server from live numbers and arrives here
 * as a string. There is no field to edit it: §9's surface matrix says
 * this action carries no free text, so nothing unreviewed can be
 * published under the hospital's name.
 *
 * The textarea is read-only rather than hidden, because the clipboard is
 * not available everywhere: an insecure origin, an old browser, a
 * locked-down work phone. On those the message still has to be
 * selectable by hand, and a copy button that silently does nothing is
 * worse than no button.
 */
export function ShareMessage({ message }: { message: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(message);
      setState('copied');
    } catch {
      setState('failed');
    }
  };

  return (
    <div className="space-y-2">
      <label
        htmlFor="share-message"
        className="block text-sm font-medium text-ink"
      >
        Message to forward
      </label>
      <textarea
        id="share-message"
        value={message}
        rows={Math.min(10, message.split('\n').length + 1)}
        readOnly
        className="w-full rounded-control border border-border-strong bg-surface-muted p-3 font-mono text-xs text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
      />

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          onClick={() => {
            void copy();
          }}
        >
          Copy the message
        </Button>
        <span className="text-xs text-ink-muted" role="status">
          {state === 'copied' ? 'Copied.' : null}
          {state === 'failed'
            ? 'Could not copy. Select the text and copy it.'
            : null}
        </span>
      </div>
    </div>
  );
}
