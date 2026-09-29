import type { AnyMessageContent, WASocket } from 'baileys';
import type { Logger } from '../logger.js';
import type { OutgoingMessage } from '../notifications/format.js';
import type { ConnectionStatus } from './connection.js';
import { fetchImage } from './image.js';
import type { Notifier, NotifierStatus } from './notifier.js';

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
  /** How long a webhook waits for WhatsApp to (re)connect before failing. */
  connectTimeoutMs?: number;
}

export class BaileysNotifier implements Notifier {
  private readonly fetchImage: (url: string) => Promise<Buffer>;
  private readonly connectTimeoutMs: number;

  constructor(private readonly options: BaileysNotifierOptions) {
    this.fetchImage = options.fetchImage ?? ((url) => fetchImage(url));
    this.connectTimeoutMs = options.connectTimeoutMs ?? 30_000;
  }

  async send(message: OutgoingMessage): Promise<void> {
    const { groupJid, connection } = this.options;
    if (!groupJid) throw new Error('WHATSAPP_GROUP_JID is not configured');

    const socket = await connection.waitUntilOpen(this.connectTimeoutMs);
    await socket.sendMessage(groupJid, await this.buildContent(message));
    this.options.logger.info('WhatsApp message sent');
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
