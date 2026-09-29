import type { Logger } from '../logger.js';
import type { OutgoingMessage } from '../notifications/format.js';

export interface NotifierStatus {
  /** True when a message sent now would be delivered. */
  ready: boolean;
  /** Short machine-readable state, e.g. `open`, `waiting-for-pairing`, `dry-run`. */
  state: string;
}

/** Delivery is impossible right now (not paired, disconnected, not configured…); retrying immediately is pointless. */
export class NotifierUnavailableError extends Error {
  override name = 'NotifierUnavailableError';

  constructor(
    readonly state: string,
    message = `Notifications cannot be delivered right now (state: ${state})`,
  ) {
    super(message);
  }
}

/** Delivers a formatted message to the configured WhatsApp group. */
export interface Notifier {
  send(message: OutgoingMessage): Promise<void>;
  getStatus(): NotifierStatus;
  close(): Promise<void>;
}

/** Dry-run notifier (`DRY_RUN=true`): logs messages instead of sending them. */
export class LogNotifier implements Notifier {
  constructor(private readonly logger: Logger) {}

  send(message: OutgoingMessage): Promise<void> {
    this.logger.info({ message }, 'Dry run: WhatsApp message not sent');
    return Promise.resolve();
  }

  getStatus(): NotifierStatus {
    return { ready: true, state: 'dry-run' };
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}
