import 'server-only';

import { forbidden, redirect, unauthorized } from 'next/navigation';

import {
  actorHas,
  currentConfig,
  decideAccess,
  nodeTokens,
  argon2Hasher,
  type Actor,
  type Permission,
  type UseCaseContext,
} from '@blood-connect/platform';
import { db } from '@blood-connect/platform';
import { idGenerator } from '@blood-connect/ids';
import { APP_TIMEZONE, dayOf } from '@blood-connect/domain';
import { AUDIENCE, currentActor, requestMetadata } from './session';

/**
 * Layer 2 of §13: the page guard.
 *
 * Every protected server component calls this before rendering. It repeats what
 * the middleware already decided, deliberately — middleware runs on a matcher
 * that a new route can be added without, and a page that renders when the
 * matcher is wrong is a page that leaks. Two layers means one mistake is not
 * enough.
 *
 * Both layers call `decideAccess`, so they can never disagree about the rule;
 * what differs is only when they run.
 */
export async function requireAccess(pathname: string): Promise<Actor> {
  const actor = await currentActor();
  const decision = decideAccess(pathname, actor, AUDIENCE);

  if (decision.allowed) return actor;

  if (decision.reason === 'unauthenticated') {
    redirect(`/sign-in?next=${encodeURIComponent(pathname)}`);
  }

  // Signed in, wrong surface. Not a redirect to sign-in: that would imply a
  // different account might work, which is both untrue and an invitation.
  forbidden();
}

/** For a component that needs a permission rather than a path. */
export async function requirePermission(permission: Permission): Promise<Actor> {
  const actor = await currentActor();
  if (actorHas(actor, permission)) return actor;
  if (actor.kind === 'user') forbidden();
  unauthorized();
}

/**
 * Builds the use-case context for a browser request (§3).
 *
 * The actor comes from the session, never from input. The correlation id ties
 * every audit row written while handling this request together (§14).
 */
export async function useCaseContext(actor: Actor): Promise<UseCaseContext> {
  const [config, request] = await Promise.all([currentConfig(), requestMetadata()]);

  return {
    db,
    clock: {
      now: () => new Date(),
      today: (timeZone: string = APP_TIMEZONE) => dayOf(new Date(), timeZone),
    },
    ids: idGenerator,
    ports: { hasher: argon2Hasher, tokens: nodeTokens },
    actor,
    correlationId: crypto.randomUUID(),
    config,
    request,
  };
}
