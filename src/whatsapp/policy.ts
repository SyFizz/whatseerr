import { DisconnectReason } from 'baileys';

/**
 * What to do after the WhatsApp socket closed.
 * - `reconnect`: transient failure, retry with exponential backoff.
 * - `reconnect-now`: expected restart (e.g. right after pairing), retry immediately.
 * - `reset-session`: credentials are no longer valid, wipe them and pair again.
 * - `stop`: retrying would be harmful (another client took over, or the account is banned).
 */
export type DisconnectAction = 'reconnect' | 'reconnect-now' | 'reset-session' | 'stop';

export function disconnectAction(statusCode: number | undefined): DisconnectAction {
  switch (statusCode) {
    case DisconnectReason.restartRequired:
      return 'reconnect-now';
    case DisconnectReason.loggedOut:
    case DisconnectReason.multideviceMismatch:
      return 'reset-session';
    case DisconnectReason.connectionReplaced:
    case DisconnectReason.forbidden:
      return 'stop';
    default:
      return 'reconnect';
  }
}

/** Exponential backoff: 1s, 2s, 4s… capped at `maxMs`. `attempt` starts at 0. */
export function backoffDelay(attempt: number, baseMs = 1_000, maxMs = 60_000): number {
  return Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt));
}

/** Extracts the HTTP-like status code carried by Baileys' Boom errors. */
export function statusCodeOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('output' in error)) return undefined;
  const { output } = error;
  if (typeof output !== 'object' || output === null || !('statusCode' in output)) return undefined;
  return typeof output.statusCode === 'number' ? output.statusCode : undefined;
}
