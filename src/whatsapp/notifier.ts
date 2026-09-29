import type { Logger } from '../logger.js';
import type { OutgoingMessage } from '../notifications/format.js';

/** Delivers a formatted message to the configured WhatsApp group. */
export interface Notifier {
  send(message: OutgoingMessage): Promise<void>;
  close(): Promise<void>;
}

/**
 * Placeholder notifier that only logs messages.
 * To be replaced by the Baileys implementation (see docs/SPEC.md, milestone M2).
 */
export class LogNotifier implements Notifier {
  constructor(private readonly logger: Logger) {}

  send(message: OutgoingMessage): Promise<void> {
    this.logger.info({ message }, 'WhatsApp delivery not implemented yet, message logged only');
    return Promise.resolve();
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}
