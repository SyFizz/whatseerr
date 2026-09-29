import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import type { Logger } from '../logger.js';

const outboxItemSchema = z.object({
  id: z.string(),
  key: z.string().optional(),
  message: z.object({ text: z.string(), imageUrl: z.string().optional() }),
  createdAt: z.number(),
  attempts: z.number().int().min(0),
});

const outboxStateSchema = z.object({
  version: z.literal(1),
  items: z.array(outboxItemSchema),
  /** Dedup key → time the last notification with this key was accepted (ms since epoch). */
  recent: z.record(z.string(), z.number()),
});

export type OutboxItem = z.infer<typeof outboxItemSchema>;
export type OutboxState = z.infer<typeof outboxStateSchema>;

export const emptyOutboxState = (): OutboxState => ({ version: 1, items: [], recent: {} });

export interface OutboxStore {
  load(): Promise<OutboxState>;
  save(state: OutboxState): Promise<void>;
}

/** Keeps the state in memory only (tests). */
export class MemoryOutboxStore implements OutboxStore {
  constructor(public state: OutboxState = emptyOutboxState()) {}

  load(): Promise<OutboxState> {
    return Promise.resolve(structuredClone(this.state));
  }

  save(state: OutboxState): Promise<void> {
    this.state = structuredClone(state);
    return Promise.resolve();
  }
}

const isErrnoException = (error: unknown): error is NodeJS.ErrnoException =>
  error instanceof Error && 'code' in error;

/** JSON file in DATA_DIR, written atomically (temporary file + rename). */
export class FileOutboxStore implements OutboxStore {
  constructor(
    private readonly path: string,
    private readonly logger: Logger,
  ) {}

  async load(): Promise<OutboxState> {
    let raw: string;
    try {
      raw = await readFile(this.path, 'utf8');
    } catch (error) {
      if (isErrnoException(error) && error.code === 'ENOENT') return emptyOutboxState();
      throw error;
    }

    let parsed: ReturnType<typeof outboxStateSchema.safeParse>;
    try {
      parsed = outboxStateSchema.safeParse(JSON.parse(raw));
    } catch {
      parsed = outboxStateSchema.safeParse(undefined);
    }
    if (parsed.success) return parsed.data;

    // Keep the unreadable file for inspection instead of silently overwriting it.
    const backup = `${this.path}.corrupt-${Date.now().toString()}`;
    await rename(this.path, backup);
    this.logger.warn({ backup }, 'Outbox file is unreadable, starting with an empty queue');
    return emptyOutboxState();
  }

  async save(state: OutboxState): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    await writeFile(tmp, JSON.stringify(state), { mode: 0o600 });
    await rename(tmp, this.path);
  }
}
