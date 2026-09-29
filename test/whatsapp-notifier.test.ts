import type { WASocket } from 'baileys';
import { describe, expect, it, vi } from 'vitest';
import { createLogger } from '../src/logger.js';
import { BaileysNotifier, type ConnectionLike } from '../src/whatsapp/baileys-notifier.js';
import { WhatsAppUnavailableError } from '../src/whatsapp/connection.js';

const GROUP = '120363000000000000@g.us';
const logger = createLogger('silent');

interface SetupOptions {
  groupJid?: string | undefined;
  fetchImage?: (url: string) => Promise<Buffer>;
}

function setup(options: SetupOptions = {}) {
  const sendMessage = vi.fn<WASocket['sendMessage']>().mockResolvedValue(undefined);
  const waitUntilOpen = vi.fn<ConnectionLike['waitUntilOpen']>(() =>
    Promise.resolve({ sendMessage }),
  );
  const connection: ConnectionLike = {
    status: 'open',
    waitUntilOpen,
    stop: vi.fn(() => Promise.resolve()),
  };
  const notifier = new BaileysNotifier({
    connection,
    groupJid: 'groupJid' in options ? options.groupJid : GROUP,
    logger,
    fetchImage: options.fetchImage ?? (() => Promise.resolve(Buffer.from('poster'))),
  });
  return { notifier, waitUntilOpen, sendMessage };
}

describe('BaileysNotifier', () => {
  it('sends the poster with the text as caption', async () => {
    const { notifier, sendMessage } = setup();
    await notifier.send({ text: 'hello', imageUrl: 'https://image.tmdb.org/p.jpg' });
    expect(sendMessage).toHaveBeenCalledWith(GROUP, {
      image: Buffer.from('poster'),
      caption: 'hello',
    });
  });

  it('falls back to text when the poster cannot be downloaded', async () => {
    const { notifier, sendMessage } = setup({
      fetchImage: () => Promise.reject(new Error('HTTP 404')),
    });
    await notifier.send({ text: 'hello', imageUrl: 'https://image.tmdb.org/p.jpg' });
    expect(sendMessage).toHaveBeenCalledWith(GROUP, { text: 'hello' });
  });

  it('sends plain text when there is no poster', async () => {
    const { notifier, sendMessage } = setup();
    await notifier.send({ text: 'hello' });
    expect(sendMessage).toHaveBeenCalledWith(GROUP, { text: 'hello' });
  });

  it('fails when no group is configured', async () => {
    const { notifier, sendMessage } = setup({ groupJid: undefined });
    await expect(notifier.send({ text: 'hello' })).rejects.toThrow(/WHATSAPP_GROUP_JID/);
    expect(sendMessage).not.toHaveBeenCalled();
    expect(notifier.getStatus()).toEqual({ ready: false, state: 'missing-group-jid' });
  });

  it('propagates connection unavailability', async () => {
    const { notifier, waitUntilOpen } = setup();
    waitUntilOpen.mockRejectedValueOnce(new WhatsAppUnavailableError('reconnecting'));
    await expect(notifier.send({ text: 'hello' })).rejects.toBeInstanceOf(WhatsAppUnavailableError);
  });

  it('is ready only when the connection is open', () => {
    expect(setup().notifier.getStatus()).toEqual({ ready: true, state: 'open' });
  });
});
