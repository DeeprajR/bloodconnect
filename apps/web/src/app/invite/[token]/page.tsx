import type { Metadata } from 'next';

import { AppShell } from '../../shell';
import { ChoosePasswordForm } from '../../forms';
import { activateAction } from '../../actions';
import { currentActor } from '@/lib/session';
import { currentConfig } from '@blood-connect/platform';

export const metadata: Metadata = { title: 'Set your password · Blood Connect' };

/**
 * The invite link (§2.3, §8).
 *
 * Public by necessity: the person opening it has no account yet. The token in
 * the path is the whole credential, so it is single-use, short-lived, and
 * superseded the moment a new invite is sent.
 */
export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const actor = await currentActor();
  const config = await currentConfig();

  const activate = activateAction.bind(null, token);

  return (
    <AppShell actor={actor} title="Set your password" narrow>
      <div className="ux4g-card ux4g-card-outline">
        <div className="ux4g-card-header">
          <h1 className="ux4g-card-title">Choose a password</h1>
          <p className="ux4g-card-sub-title">
            This signs you in and takes you to your dashboard.
          </p>
        </div>
        <div className="ux4g-card-body">
          <ChoosePasswordForm
            action={activate}
            minimumLength={config.auth.minPasswordLength}
            label="Set password and sign in"
          />
        </div>
      </div>
    </AppShell>
  );
}
