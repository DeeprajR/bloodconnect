import type { Metadata } from 'next';

import { Card } from '@blood-connect/ui';

import { ChoosePasswordForm } from '../../forms';
import { activateAction } from '../../actions';
import { currentConfig } from '@blood-connect/platform';

export const metadata: Metadata = { title: 'Set your password · Blood Connect' };

/**
 * The invite link (§2.3, §8).
 *
 * Public by necessity: the person opening it has no account yet. The
 * token in the path is the whole credential, so it is single-use,
 * short-lived, and superseded the moment a new invite is sent.
 */
export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const config = await currentConfig();

  const activate = activateAction.bind(null, token);

  return (
    <div
      id="main"
      className="flex min-h-dvh items-center justify-center bg-canvas p-6"
    >
      <div className="w-full max-w-md space-y-6">
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="flex size-9 items-center justify-center rounded-control bg-primary text-base font-bold text-white"
          >
            B
          </span>
          <div>
            <p className="text-base font-semibold text-ink">Blood Connect</p>
            <p className="text-xs text-ink-subtle">Set your password</p>
          </div>
        </div>

        <Card title="Choose a password">
          <p className="mb-4 text-xs text-ink-subtle">
            This signs you in and takes you to your dashboard.
          </p>
          <ChoosePasswordForm
            action={activate}
            minimumLength={config.auth.minPasswordLength}
            label="Set password and sign in"
          />
        </Card>
      </div>
    </div>
  );
}
