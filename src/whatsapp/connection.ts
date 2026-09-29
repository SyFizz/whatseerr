import type { ConnectionState, WASocket } from 'baileys';
import QRCode from 'qrcode';
import type { Logger } from '../logger.js';
import { NotifierUnavailableError } from './notifier.js';
import { backoffDelay, disconnectAction, statusCodeOf } from './policy.js';
import {
  clearAuthStore,
  createBaileysSocket,
  loadAuthStore,
  type AuthStore,
  type SocketFactory,
} from './socket.js';

export type ConnectionStatus =
  'connecting' | 'waiting-for-pairing' | 'open' | 'reconnecting' | 'stopped';

export class WhatsAppUnavailableError extends NotifierUnavailableError {
  override name = 'WhatsAppUnavailableError';

  constructor(status: ConnectionStatus) {
    super(status, `WhatsApp is not connected (status: ${status})`);
  }
}

export interface WhatsAppConnectionOptions {
  /** Directory holding the Baileys session. Equivalent to a password: keep it private. */
  authDir: string;
  /** When set, pair with an 8-character code for this number instead of a QR code. */
  pairingPhone?: string | undefined;
  logger: Logger;
  /** Logger handed to Baileys, usually a quieter child of `logger`. */
  baileysLogger: Logger;
  createSocket?: SocketFactory;
  loadAuth?: (dir: string) => Promise<AuthStore>;
  clearAuth?: (dir: string) => Promise<void>;
  /** Raw output for human-oriented content (QR code, pairing code). Defaults to stdout. */
  print?: (text: string) => void;
}

/** Per-socket state, reset on every reconnection. */
interface SocketSession {
  socket: WASocket;
  pairingRequested: boolean;
}

/**
 * Owns the Baileys socket lifecycle: pairing (QR or code), reconnection with backoff,
 * session reset when WhatsApp logs the device out.
 */
export class WhatsAppConnection {
  private currentStatus: ConnectionStatus = 'connecting';
  private session: SocketSession | undefined;
  private attempt = 0;
  private retryTimer: NodeJS.Timeout | undefined;
  private stopped = false;
  private readonly waiters = new Set<(socket: WASocket) => void>();
  private readonly openListeners: ((socket: WASocket) => void | Promise<void>)[] = [];

  private readonly createSocket: SocketFactory;
  private readonly loadAuth: (dir: string) => Promise<AuthStore>;
  private readonly clearAuth: (dir: string) => Promise<void>;
  private readonly print: (text: string) => void;

  constructor(private readonly options: WhatsAppConnectionOptions) {
    this.createSocket = options.createSocket ?? createBaileysSocket;
    this.loadAuth = options.loadAuth ?? loadAuthStore;
    this.clearAuth = options.clearAuth ?? clearAuthStore;
    this.print = options.print ?? ((text) => process.stdout.write(text));
  }

  get status(): ConnectionStatus {
    return this.currentStatus;
  }

  /** Starts connecting in the background; never throws. */
  start(): void {
    void this.connect();
  }

  /** Registers a callback run every time the connection opens. */
  onOpen(listener: (socket: WASocket) => void | Promise<void>): void {
    this.openListeners.push(listener);
  }

  /** Resolves with the open socket, or rejects with `WhatsAppUnavailableError` after `timeoutMs`. */
  waitUntilOpen(timeoutMs: number): Promise<WASocket> {
    if (this.currentStatus === 'open' && this.session) {
      return Promise.resolve(this.session.socket);
    }
    return new Promise((resolve, reject) => {
      const onOpen = (socket: WASocket) => {
        clearTimeout(timer);
        resolve(socket);
      };
      const timer = setTimeout(() => {
        this.waiters.delete(onOpen);
        reject(new WhatsAppUnavailableError(this.currentStatus));
      }, timeoutMs);
      this.waiters.add(onOpen);
    });
  }

  /** Closes the socket without logging the device out, so the session stays valid. */
  async stop(): Promise<void> {
    this.stopped = true;
    this.currentStatus = 'stopped';
    clearTimeout(this.retryTimer);
    const socket = this.session?.socket;
    this.session = undefined;
    await socket?.end(undefined);
  }

  private isStopped(): boolean {
    return this.stopped;
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    this.currentStatus = 'connecting';
    try {
      const { state, saveCreds } = await this.loadAuth(this.options.authDir);
      const socket = await this.createSocket(state, this.options.baileysLogger);
      // stop() may have been called while the socket was being created.
      if (this.isStopped()) {
        await socket.end(undefined);
        return;
      }
      const session: SocketSession = { socket, pairingRequested: false };
      this.session = session;
      socket.ev.on('creds.update', () => {
        saveCreds().catch((error: unknown) => {
          this.options.logger.error({ err: error }, 'Failed to persist WhatsApp credentials');
        });
      });
      socket.ev.on('connection.update', (update) => {
        this.handleUpdate(session, update);
      });
    } catch (error) {
      this.options.logger.error({ err: error }, 'Failed to start the WhatsApp connection');
      this.scheduleReconnect(backoffDelay(this.attempt++));
    }
  }

  private handleUpdate(session: SocketSession, update: Partial<ConnectionState>): void {
    if (session !== this.session) return; // event from a stale socket
    const { connection, qr, lastDisconnect } = update;
    if (qr) void this.handleQr(session, qr);
    if (connection === 'open') this.handleOpen(session.socket);
    if (connection === 'close') void this.handleClose(statusCodeOf(lastDisconnect?.error));
  }

  private async handleQr(session: SocketSession, qr: string): Promise<void> {
    this.currentStatus = 'waiting-for-pairing';
    const { pairingPhone, logger } = this.options;
    try {
      if (pairingPhone) {
        if (session.pairingRequested || session.socket.authState.creds.registered) return;
        session.pairingRequested = true;
        const code = await session.socket.requestPairingCode(pairingPhone);
        this.print(
          `\nWhatsApp pairing code: ${code}\n` +
            'On the phone: WhatsApp > Linked devices > Link a device > Link with phone number.\n\n',
        );
        logger.info('WhatsApp pairing code printed, waiting for pairing');
        return;
      }
      const rendered = await QRCode.toString(qr, { type: 'terminal', small: true });
      this.print(
        '\nScan this QR code with WhatsApp > Linked devices > Link a device:\n' + `${rendered}\n`,
      );
      logger.info('WhatsApp QR code printed, waiting for pairing');
    } catch (error) {
      logger.error({ err: error }, 'Failed to display the WhatsApp pairing information');
    }
  }

  private handleOpen(socket: WASocket): void {
    this.currentStatus = 'open';
    this.attempt = 0;
    this.options.logger.info('WhatsApp connected');
    for (const resolve of this.waiters) resolve(socket);
    this.waiters.clear();
    for (const listener of this.openListeners) {
      Promise.resolve(listener(socket)).catch((error: unknown) => {
        this.options.logger.error({ err: error }, 'WhatsApp open listener failed');
      });
    }
  }

  private async handleClose(statusCode: number | undefined): Promise<void> {
    this.session = undefined;
    if (this.stopped) return;
    const { logger, authDir } = this.options;

    switch (disconnectAction(statusCode)) {
      case 'stop':
        this.currentStatus = 'stopped';
        logger.error(
          { statusCode },
          'WhatsApp closed the connection permanently (session used elsewhere or account banned); restart after fixing it',
        );
        return;
      case 'reset-session':
        logger.warn({ statusCode }, 'WhatsApp session is no longer valid, clearing it: pair again');
        try {
          await this.clearAuth(authDir);
        } catch (error) {
          logger.error({ err: error }, 'Failed to clear the WhatsApp session');
        }
        this.scheduleReconnect(0);
        return;
      case 'reconnect-now':
        this.scheduleReconnect(0);
        return;
      case 'reconnect': {
        const delayMs = backoffDelay(this.attempt++);
        logger.warn({ statusCode, delayMs }, 'WhatsApp connection closed, reconnecting');
        this.scheduleReconnect(delayMs);
        return;
      }
    }
  }

  private scheduleReconnect(delayMs: number): void {
    if (this.stopped) return;
    this.currentStatus = 'reconnecting';
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => void this.connect(), delayMs);
  }
}
