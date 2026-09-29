import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLogger } from '../src/logger.js';
import type { OutgoingMessage } from '../src/notifications/format.js';
import { Outbox, type OutboxOptions } from '../src/notifications/outbox.js';
import { MemoryOutboxStore, emptyOutboxState } from '../src/notifications/outbox-store.js';
import { NotifierUnavailableError } from '../src/whatsapp/notifier.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const message = (text: string): OutgoingMessage => ({ text });

async function setup(overrides: Partial<OutboxOptions> = {}, store = new MemoryOutboxStore()) {
  const send = vi.fn<(message: OutgoingMessage) => Promise<void>>().mockResolvedValue(undefined);
  const outbox = await Outbox.open({
    notifier: { send },
    store,
    logger: createLogger('silent'),
    dedupWindowMs: 6 * HOUR,
    maxAgeMs: 24 * HOUR,
    sendIntervalMs: 5_000,
    ...overrides,
  });
  const sentTexts = () => send.mock.calls.map(([sent]) => sent.text);
  return { outbox, send, store, sentTexts };
}

describe('Outbox', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('persists a message before acknowledging it', async () => {
    const { outbox, store } = await setup();
    await expect(outbox.enqueue(message('a'), 'movie:tmdb:1')).resolves.toBe('queued');
    expect(store.state.items.map((item) => item.message.text)).toEqual(['a']);
    expect(outbox.size).toBe(1);
  });

  it('delivers messages in order, spaced by the send interval', async () => {
    const { outbox, store, sentTexts } = await setup();
    await outbox.enqueue(message('a'));
    await outbox.enqueue(message('b'));
    outbox.start();

    await vi.advanceTimersByTimeAsync(0);
    expect(sentTexts()).toEqual(['a']);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(sentTexts()).toEqual(['a']);
    await vi.advanceTimersByTimeAsync(1);
    expect(sentTexts()).toEqual(['a', 'b']);
    expect(store.state.items).toEqual([]);
    await outbox.stop();
  });

  it('wakes up when a message arrives while idle', async () => {
    const { outbox, sentTexts } = await setup();
    outbox.start();
    await vi.advanceTimersByTimeAsync(10_000);
    await outbox.enqueue(message('late'));
    await vi.advanceTimersByTimeAsync(0);
    expect(sentTexts()).toEqual(['late']);
    await outbox.stop();
  });

  it('keeps failed messages and retries them with backoff', async () => {
    const { outbox, send, store } = await setup();
    send.mockRejectedValueOnce(new NotifierUnavailableError('reconnecting'));
    send.mockRejectedValueOnce(new Error('timeout'));
    await outbox.enqueue(message('a'));
    outbox.start();

    await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledTimes(1);
    expect(store.state.items[0]?.attempts).toBe(1);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(send).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(send).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(send).toHaveBeenCalledTimes(3);
    expect(store.state.items).toEqual([]);
    await outbox.stop();
  });

  it('retries immediately when WhatsApp reconnects', async () => {
    const { outbox, send } = await setup();
    send.mockRejectedValueOnce(new NotifierUnavailableError('waiting-for-pairing'));
    await outbox.enqueue(message('a'));
    outbox.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledTimes(1);

    outbox.retryNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledTimes(2);
    expect(outbox.size).toBe(0);
    await outbox.stop();
  });

  it('drops the same media within the dedup window, and accepts it afterwards', async () => {
    const { outbox } = await setup();
    await expect(outbox.enqueue(message('S1'), 'tv:tmdb:9')).resolves.toBe('queued');
    await expect(outbox.enqueue(message('S2'), 'tv:tmdb:9')).resolves.toBe('duplicate');
    await expect(outbox.enqueue(message('other'), 'tv:tmdb:10')).resolves.toBe('queued');

    vi.advanceTimersByTime(6 * HOUR);
    await expect(outbox.enqueue(message('S3'), 'tv:tmdb:9')).resolves.toBe('queued');
    expect(outbox.size).toBe(3);
  });

  it('does not de-duplicate when the window is 0', async () => {
    const { outbox } = await setup({ dedupWindowMs: 0 });
    await outbox.enqueue(message('a'), 'movie:tmdb:1');
    await expect(outbox.enqueue(message('b'), 'movie:tmdb:1')).resolves.toBe('queued');
  });

  it('drops messages that could not be delivered before they expired', async () => {
    const { outbox, send, sentTexts } = await setup({ maxAgeMs: 2 * MINUTE });
    send.mockRejectedValue(new NotifierUnavailableError('waiting-for-pairing'));
    await outbox.enqueue(message('stale'));
    outbox.start();
    await vi.advanceTimersByTimeAsync(3 * MINUTE);
    expect(outbox.size).toBe(0);

    send.mockResolvedValue(undefined);
    await outbox.enqueue(message('fresh'));
    await vi.advanceTimersByTimeAsync(0);
    expect(sentTexts().at(-1)).toBe('fresh');
    await outbox.stop();
  });

  it('drops the oldest message when full', async () => {
    const { outbox, store } = await setup({ maxItems: 2 });
    await outbox.enqueue(message('a'));
    await outbox.enqueue(message('b'));
    await outbox.enqueue(message('c'));
    expect(store.state.items.map((item) => item.message.text)).toEqual(['b', 'c']);
  });

  it('resumes the persisted queue and dedup history on start', async () => {
    const store = new MemoryOutboxStore({
      ...emptyOutboxState(),
      items: [{ id: '1', message: { text: 'pending' }, createdAt: Date.now(), attempts: 2 }],
      recent: { 'movie:tmdb:1': Date.now() },
    });
    const { outbox, sentTexts } = await setup({}, store);
    await expect(outbox.enqueue(message('again'), 'movie:tmdb:1')).resolves.toBe('duplicate');

    outbox.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(sentTexts()).toEqual(['pending']);
    await outbox.stop();
  });

  it('stops without waiting for pending retries', async () => {
    const { outbox, send } = await setup();
    send.mockRejectedValue(new Error('down'));
    await outbox.enqueue(message('a'));
    outbox.start();
    await vi.advanceTimersByTimeAsync(0);

    const stopping = outbox.stop();
    await vi.advanceTimersByTimeAsync(0);
    await stopping;
    await vi.advanceTimersByTimeAsync(10 * MINUTE);
    expect(send).toHaveBeenCalledTimes(1);
    expect(outbox.size).toBe(1);
  });
});
