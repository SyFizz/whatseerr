import { randomUUID } from 'node:crypto';
import type { Logger } from '../logger.js';
import { backoffDelay } from '../whatsapp/policy.js';
import type { Notifier } from '../whatsapp/notifier.js';
import type { OutgoingMessage } from './format.js';
import type { OutboxItem, OutboxState, OutboxStore } from './outbox-store.js';

export type EnqueueResult = 'queued' | 'duplicate';

/** The part of the outbox the HTTP layer uses. */
export interface OutboxLike {
  enqueue(message: OutgoingMessage, key?: string): Promise<EnqueueResult>;
  readonly size: number;
}

export interface OutboxOptions {
  notifier: Pick<Notifier, 'send'>;
  store: OutboxStore;
  logger: Logger;
  /** Notifications with the same dedup key within this window are dropped (0 disables). */
  dedupWindowMs: number;
  /** Queued messages older than this are dropped: the news is stale. */
  maxAgeMs: number;
  /** Minimum delay between two messages, to limit the WhatsApp ban risk. */
  sendIntervalMs: number;
  /** Beyond this, the oldest messages are dropped. */
  maxItems?: number;
  now?: () => number;
}

const RETRY_BASE_MS = 5_000;
const RETRY_MAX_MS = 60_000;
/** On shutdown, how long to wait for an in-flight message before saving the queue anyway. */
const STOP_GRACE_MS = 5_000;

type WaitReason = 'idle' | 'retry' | 'throttle';

/**
 * Durable queue between Seerr and WhatsApp. Seerr never retries a webhook, so a notification
 * received while WhatsApp is down (not paired yet, reconnecting, container restarting) would be
 * lost without it. Messages are persisted before the webhook is acknowledged, delivered one at a
 * time with a minimum interval, and retried with backoff until they expire.
 */
export class Outbox implements OutboxLike {
  private readonly now: () => number;
  private readonly maxItems: number;
  private stopped = false;
  private loop: Promise<void> | undefined;
  private wakeUp: { reason: WaitReason; resolve: () => void } | undefined;
  private saving: Promise<void> = Promise.resolve();

  private constructor(
    private readonly options: OutboxOptions,
    private readonly state: OutboxState,
  ) {
    this.now = options.now ?? Date.now;
    this.maxItems = options.maxItems ?? 100;
  }

  static async open(options: OutboxOptions): Promise<Outbox> {
    const outbox = new Outbox(options, await options.store.load());
    if (outbox.size > 0) {
      options.logger.info({ queued: outbox.size }, 'Resuming queued WhatsApp messages');
    }
    return outbox;
  }

  get size(): number {
    return this.state.items.length;
  }

  async enqueue(message: OutgoingMessage, key?: string): Promise<EnqueueResult> {
    const now = this.now();
    this.pruneRecent(now);

    if (key && this.options.dedupWindowMs > 0 && Object.hasOwn(this.state.recent, key)) {
      this.options.logger.info({ key }, 'Duplicate notification dropped');
      return 'duplicate';
    }
    if (key && this.options.dedupWindowMs > 0) this.state.recent[key] = now;

    const item: OutboxItem = { id: randomUUID(), message, createdAt: now, attempts: 0 };
    if (key) item.key = key;
    this.state.items.push(item);

    while (this.state.items.length > this.maxItems) {
      const dropped = this.state.items.shift();
      this.options.logger.warn({ id: dropped?.id }, 'Outbox is full, oldest message dropped');
    }

    // Acknowledge the webhook only once the message is on disk.
    await this.persist();
    this.wake('idle');
    return 'queued';
  }

  start(): void {
    this.loop ??= this.run();
  }

  /** Retries the pending message right away, e.g. when WhatsApp (re)connects. */
  retryNow(): void {
    this.wake('idle', 'retry');
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.wake('idle', 'retry', 'throttle');
    if (this.loop) {
      let timer: NodeJS.Timeout | undefined;
      const grace = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, STOP_GRACE_MS);
      });
      await Promise.race([this.loop, grace]);
      clearTimeout(timer);
    }
    await this.persist();
  }

  private async run(): Promise<void> {
    while (!this.stopped) {
      await this.dropExpired();
      const item = this.state.items[0];
      if (!item) {
        await this.wait('idle');
        continue;
      }

      try {
        await this.options.notifier.send(item.message);
      } catch (error) {
        item.attempts += 1;
        await this.persist();
        const delayMs = backoffDelay(item.attempts - 1, RETRY_BASE_MS, RETRY_MAX_MS);
        // Warn once, then keep quiet: WhatsApp may stay down for hours (e.g. waiting for pairing).
        const level = item.attempts === 1 ? 'warn' : 'debug';
        this.options.logger[level](
          { err: error, id: item.id, attempts: item.attempts, retryInMs: delayMs },
          'WhatsApp delivery failed, message kept in the queue',
        );
        await this.wait('retry', delayMs);
        continue;
      }

      // Remove by id: the queue may have changed while sending (expiry, overflow).
      this.state.items = this.state.items.filter((queued) => queued.id !== item.id);
      await this.persist();
      this.options.logger.info({ id: item.id, queued: this.size }, 'Queued message delivered');
      await this.wait('throttle', this.options.sendIntervalMs);
    }
  }

  private async dropExpired(): Promise<void> {
    const limit = this.now() - this.options.maxAgeMs;
    const expired = this.state.items.filter((item) => item.createdAt < limit);
    if (expired.length === 0) return;

    this.state.items = this.state.items.filter((item) => item.createdAt >= limit);
    for (const item of expired) {
      this.options.logger.warn(
        { id: item.id, attempts: item.attempts },
        'Queued message expired before it could be delivered',
      );
    }
    await this.persist();
  }

  private pruneRecent(now: number): void {
    this.state.recent = Object.fromEntries(
      Object.entries(this.state.recent).filter(
        ([, acceptedAt]) => now - acceptedAt < this.options.dedupWindowMs,
      ),
    );
  }

  private wait(reason: WaitReason, ms?: number): Promise<void> {
    if (this.stopped) return Promise.resolve();
    return new Promise((resolve) => {
      let timer: NodeJS.Timeout | undefined;
      const done = () => {
        clearTimeout(timer);
        if (this.wakeUp?.resolve === done) this.wakeUp = undefined;
        resolve();
      };
      if (ms !== undefined) timer = setTimeout(done, ms);
      this.wakeUp = { reason, resolve: done };
    });
  }

  private wake(...reasons: WaitReason[]): void {
    const pending = this.wakeUp;
    if (pending && reasons.includes(pending.reason)) pending.resolve();
  }

  /** Writes are chained so that the file always reflects the latest state. */
  private persist(): Promise<void> {
    const snapshot = structuredClone(this.state);
    this.saving = this.saving
      .then(() => this.options.store.save(snapshot))
      .catch((error: unknown) => {
        this.options.logger.error({ err: error }, 'Failed to save the outbox');
      });
    return this.saving;
  }
}
