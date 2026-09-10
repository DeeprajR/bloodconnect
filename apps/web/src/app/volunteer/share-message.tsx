'use client';

import { useState } from 'react';

/**
 * The message a volunteer pastes into a community group (§6).
 *
 * The text is generated on the server from live numbers and arrives here as a
 * string. There is no field to edit it: §9's surface matrix says this action
 * carries no free text, so nothing unreviewed can be published under the
 * hospital's name.
 *
 * The textarea is read-only rather than hidden, because the clipboard is not
 * available everywhere: an insecure origin, an old browser, a locked-down work
 * phone. On those the message still has to be selectable by hand, and a copy
 * button that silently does nothing is worse than no button.
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
    <div className="app-stack-tight">
      <label className="ux4g-label-m-strong" htmlFor="share-message">
        Message to forward
      </label>
      <textarea
        className="ux4g-input app-share-box"
        id="share-message"
        value={message}
        rows={Math.min(10, message.split('\n').length + 1)}
        readOnly
      />

      <div className="app-row">
        <button
          type="button"
          className="ux4g-btn ux4g-btn-primary ux4g-btn-md app-target"
          onClick={() => {
            void copy();
          }}
        >
          Copy the message
        </button>
        <span className="ux4g-label-m-default" role="status">
          {state === 'copied' ? 'Copied.' : null}
          {state === 'failed' ? 'Could not copy. Select the text and copy it.' : null}
        </span>
      </div>
    </div>
  );
}
