import { EventEmitter } from 'node:events';
import type { AuthenticationState, ConnectionState, WASocket } from 'baileys';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLogger } from '../src/logger.js';
import { WhatsAppConnection, WhatsAppUnavailableError } from '../src/whatsapp/connection.js';

/** Minimal stand-in for a Baileys socket, driven by the test through `emit`. */
class FakeSocket {
  readonly ev = new EventEmitter();
  readonly authState = { creds: { registered: false } };
  readonly requestPairingCode = vi.fn().mockResolvedValue('ABCD1234');
  readonly end = vi.fn().mockResolvedValue(undefined);

  update(update: Partial<ConnectionState>): void {
    this.ev.emit('connection.update', update);
  }

  close(statusCode: number): void {
    this.update({
      connection: 'close',
      lastDisconnect: {
        error: Object.assign(new Error('closed'), { output: { statusCode } }),
        date: new Date(),
      },
    });
  }
}

const logger = createLogger('silent');

function setup(options: { pairingPhone?: string } = {}) {
  const sockets: FakeSocket[] = [];
  const createSocket = vi.fn(() => {
    const socket = new FakeSocket();
    sockets.push(socket);
    return Promise.resolve(socket as unknown as WASocket);
  });
  const clearAuth = vi.fn().mockResolvedValue(undefined);
  const print = vi.fn<(text: string) => void>();
  const connection = new WhatsAppConnection({
    authDir: '/tmp/unused',
    pairingPhone: options.pairingPhone,
    logger,
    baileysLogger: logger,
    createSocket,
    loadAuth: () =>
      Promise.resolve({ state: {} as AuthenticationState, saveCreds: () => Promise.resolve() }),
    clearAuth,
    print,
  });
  const latest = () => {
    const socket = sockets.at(-1);
    if (!socket) throw new Error('no socket created yet');
    return socket;
  };
  return { connection, createSocket, clearAuth, print, sockets, latest };
}

describe('WhatsAppConnection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('prints a QR code and becomes open once paired', async () => {
    const { connection, latest, print } = setup();
    connection.start();
    await vi.runAllTimersAsync();

    latest().update({ qr: '2@fake-qr-payload' });
    await vi.runAllTimersAsync();
    expect(connection.status).toBe('waiting-for-pairing');
    expect(print).toHaveBeenCalledWith(expect.stringContaining('Scan this QR code'));

    const opened = connection.waitUntilOpen(5_000);
    latest().update({ connection: 'open' });
    await expect(opened).resolves.toBe(latest());
    expect(connection.status).toBe('open');
  });

  it('requests a single pairing code when a phone number is configured', async () => {
    const { connection, latest, print } = setup({ pairingPhone: '33600000000' });
    connection.start();
    await vi.runAllTimersAsync();

    latest().update({ qr: 'qr-1' });
    latest().update({ qr: 'qr-2' });
    await vi.runAllTimersAsync();

    expect(latest().requestPairingCode).toHaveBeenCalledOnce();
    expect(latest().requestPairingCode).toHaveBeenCalledWith('33600000000');
    expect(print).toHaveBeenCalledWith(expect.stringContaining('ABCD1234'));
  });

  it('reconnects with backoff after a transient disconnect', async () => {
    const { connection, createSocket, latest } = setup();
    connection.start();
    await vi.runAllTimersAsync();

    latest().close(408);
    expect(connection.status).toBe('reconnecting');
    await vi.advanceTimersByTimeAsync(999);
    expect(createSocket).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(createSocket).toHaveBeenCalledTimes(2);
  });

  it('clears the session and reconnects when logged out', async () => {
    const { connection, createSocket, clearAuth, latest } = setup();
    connection.start();
    await vi.runAllTimersAsync();

    latest().close(401);
    await vi.runAllTimersAsync();
    expect(clearAuth).toHaveBeenCalledWith('/tmp/unused');
    expect(createSocket).toHaveBeenCalledTimes(2);
  });

  it('stops when another client replaced the session', async () => {
    const { connection, createSocket, latest } = setup();
    connection.start();
    await vi.runAllTimersAsync();

    latest().close(440);
    await vi.runAllTimersAsync();
    expect(connection.status).toBe('stopped');
    expect(createSocket).toHaveBeenCalledOnce();
  });

  it('ignores events from a stale socket', async () => {
    const { connection, sockets, latest } = setup();
    connection.start();
    await vi.runAllTimersAsync();
    latest().close(408);
    await vi.runAllTimersAsync();

    sockets[0]?.update({ connection: 'open' });
    expect(connection.status).not.toBe('open');
  });

  it('rejects waiters when the connection does not open in time', async () => {
    const { connection } = setup();
    connection.start();
    const opened = connection.waitUntilOpen(1_000);
    const assertion = expect(opened).rejects.toBeInstanceOf(WhatsAppUnavailableError);
    await vi.advanceTimersByTimeAsync(1_000);
    await assertion;
  });

  it('ends the socket on stop without reconnecting', async () => {
    const { connection, createSocket, latest } = setup();
    connection.start();
    await vi.runAllTimersAsync();

    await connection.stop();
    expect(latest().end).toHaveBeenCalledOnce();
    latest().close(408);
    await vi.runAllTimersAsync();
    expect(createSocket).toHaveBeenCalledOnce();
  });
});
