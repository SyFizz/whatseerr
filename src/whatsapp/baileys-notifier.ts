import type { AnyMessageContent, WASocket } from 'baileys';
import type { Logger } from '../logger.js';
import type { OutgoingMessage } from '../notifications/format.js';
import { WhatsAppUnavailableError, type ConnectionStatus } from './connection.js';
import { fetchImage } from './image.js';
import { NotifierUnavailableError, type Notifier, type NotifierStatus } from './notifier.js';

/** The part of `WhatsAppConnection` the notifier relies on. */
export interface ConnectionLike {
  readonly status: ConnectionStatus;
  waitUntilOpen(timeoutMs: number): Promise<Pick<WASocket, 'sendMessage'>>;
  stop(): Promise<void>;
}

export interface BaileysNotifierOptions {
  connection: ConnectionLike;
  groupJid: string | undefined;
  logger: Logger;
  fetchImage?: (url: string) => Promise<Buffer>;
  /** How long a webhook waits for WhatsApp to reconnect before failing. */
  connectTimeoutMs?: number;
  /** How long a webhook waits for WhatsApp to accept the message before failing. */
  sendTimeoutMs?: number;
}

/** States where waiting is pointless: a human must act (pair the device, fix the session). */
const HOPELESS_STATES: readonly ConnectionStatus[] = ['waiting-for-pairing', 'stopped'];

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    clearTimeout(timer);
  });
}

/**
 * Seerr sends webhooks without any timeout, so every path here is bounded:
 * a request must never hang the Seerr UI.
 */
export class BaileysNotifier implements Notifier {
  private readonly fetchImage: (url: string) => Promise<Buffer>;
  private readonly connectTimeoutMs: number;
  private readonly sendTimeoutMs: number;

  constructor(private readonly options: BaileysNotifierOptions) {
    this.fetchImage = options.fetchImage ?? ((url) => fetchImage(url));
    this.connectTimeoutMs = options.connectTimeoutMs ?? 10_000;
    this.sendTimeoutMs = options.sendTimeoutMs ?? 20_000;
  }

  async send(message: OutgoingMessage): Promise<void> {
    const { groupJid, connection, logger } = this.options;
    if (!groupJid) {
      throw new NotifierUnavailableError(
        'missing-group-jid',
        'WHATSAPP_GROUP_JID is not configured',
      );
    }
    if (HOPELESS_STATES.includes(connection.status)) {
      throw new WhatsAppUnavailableError(connection.status);
    }

    const socket = await connection.waitUntilOpen(this.connectTimeoutMs);
    const content = await this.buildContent(message);
    await withTimeout(
      socket.sendMessage(groupJid, content),
      this.sendTimeoutMs,
      `WhatsApp did not accept the message within ${this.sendTimeoutMs} ms`,
    );
    logger.info('WhatsApp message sent');
  }

  getStatus(): NotifierStatus {
    if (!this.options.groupJid) return { ready: false, state: 'missing-group-jid' };
    const { status } = this.options.connection;
    return { ready: status === 'open', state: status };
  }

  close(): Promise<void> {
    return this.options.connection.stop();
  }

  /** Poster as an image with caption; plain text if there is no poster or it cannot be fetched. */
  private async buildContent(message: OutgoingMessage): Promise<AnyMessageContent> {
    if (message.imageUrl) {
      try {
        const image = await this.fetchImage(message.imageUrl);
        return { image, caption: message.text };
      } catch (error) {
        this.options.logger.warn({ err: error }, 'Poster download failed, sending text only');
      }
    }
    return { text: message.text };
  }
}
