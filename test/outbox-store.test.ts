import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLogger } from '../src/logger.js';
import { FileOutboxStore, emptyOutboxState } from '../src/notifications/outbox-store.js';

describe('FileOutboxStore', () => {
  let dir: string;
  let store: FileOutboxStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'whatseerr-outbox-'));
    store = new FileOutboxStore(join(dir, 'nested', 'outbox.json'), createLogger('silent'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('starts empty when the file does not exist', async () => {
    await expect(store.load()).resolves.toEqual(emptyOutboxState());
  });

  it('round-trips the state', async () => {
    const state = {
      ...emptyOutboxState(),
      items: [
        {
          id: 'a',
          key: 'movie:tmdb:1',
          message: { text: 'hello', imageUrl: 'https://image.example.com/p.jpg' },
          createdAt: 1,
          attempts: 0,
        },
      ],
      recent: { 'movie:tmdb:1': 1 },
    };
    await store.save(state);
    await expect(store.load()).resolves.toEqual(state);
    expect(await readdir(join(dir, 'nested'))).toEqual(['outbox.json']);
  });

  it('sets an unreadable file aside and starts empty', async () => {
    await store.save(emptyOutboxState());
    await writeFile(join(dir, 'nested', 'outbox.json'), '{ not json');
    await expect(store.load()).resolves.toEqual(emptyOutboxState());
    const files = await readdir(join(dir, 'nested'));
    expect(files.some((file) => file.startsWith('outbox.json.corrupt-'))).toBe(true);
  });
});
