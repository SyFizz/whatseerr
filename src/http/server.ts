import { createHash, timingSafeEqual } from 'node:crypto';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import type { Messages } from '../i18n/index.js';
import type { Logger } from '../logger.js';
import { dedupKey } from '../notifications/dedup.js';
import { formatNotification } from '../notifications/format.js';
import type { OutboxLike } from '../notifications/outbox.js';
import { NotificationType, seerrPayloadSchema } from '../seerr/payload.js';
import type { GroupSummary } from '../whatsapp/groups.js';
import { NotifierUnavailableError, type Notifier } from '../whatsapp/notifier.js';

export interface ServerDeps {
  webhookSecret: string;
  messages: Messages;
  notifier: Notifier;
  /** Durable queue used for media notifications. */
  outbox: OutboxLike;
  logger: Logger;
  /** Lists the WhatsApp groups of the paired account; absent in dry-run mode. */
  listGroups?: (() => Promise<GroupSummary[]>) | undefined;
}

const sha256 = (value: string) => createHash('sha256').update(value).digest();

/** Constant-time check of the `Authorization: Bearer <secret>` header sent by Seerr. */
export function isAuthorized(header: string | undefined, secret: string): boolean {
  if (!header) return false;
  return timingSafeEqual(sha256(header), sha256(`Bearer ${secret}`));
}

export function buildServer(deps: ServerDeps) {
  const app = Fastify({ loggerInstance: deps.logger, bodyLimit: 256 * 1024 });

  const requireSecret = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!isAuthorized(request.headers.authorization, deps.webhookSecret)) {
      await reply.code(401).send({ error: 'unauthorized' });
    }
  };

  // Silenced: the Docker healthcheck polls it every 30s.
  app.get('/healthz', { logLevel: 'silent' }, () => ({ status: 'ok' }));

  // Readiness: 200 only when a notification would actually reach the WhatsApp group.
  app.get('/readyz', { logLevel: 'silent' }, (_request, reply) => {
    const status = deps.notifier.getStatus();
    return reply.code(status.ready ? 200 : 503).send({ ...status, queued: deps.outbox.size });
  });

  // Group names are private: protected by the same secret as the webhook.
  app.get('/groups', { preHandler: requireSecret }, async (request, reply) => {
    if (!deps.listGroups) {
      return reply.code(404).send({ error: 'not available in dry-run mode' });
    }
    try {
      return { groups: await deps.listGroups() };
    } catch (error) {
      request.log.warn({ err: error }, 'Failed to list WhatsApp groups');
      return reply.code(503).send({ error: 'whatsapp unavailable' });
    }
  });

  app.post('/webhook', { preHandler: requireSecret }, async (request, reply) => {
    const parsed = seerrPayloadSchema.safeParse(request.body);
    if (!parsed.success) {
      request.log.warn({ issues: parsed.error.issues }, 'Invalid Seerr payload');
      return reply.code(400).send({ error: 'invalid payload' });
    }

    const message = formatNotification(parsed.data, deps.messages);
    if (!message) {
      request.log.debug({ type: parsed.data.notification_type }, 'Notification type ignored');
      return reply.code(202).send({ status: 'ignored' });
    }

    // Media notifications are queued: Seerr never retries, so they must survive a WhatsApp outage.
    if (parsed.data.notification_type !== NotificationType.TestNotification) {
      const status = await deps.outbox.enqueue(message, dedupKey(parsed.data));
      return reply.code(202).send({ status });
    }

    // The Seerr "Test" button is sent directly, so that it reports whether WhatsApp works.
    try {
      await deps.notifier.send(message);
    } catch (error) {
      if (error instanceof NotifierUnavailableError) {
        request.log.warn({ state: error.state }, `WhatsApp message not sent: ${error.message}`);
        return reply.code(503).send({ error: 'whatsapp unavailable', state: error.state });
      }
      request.log.error({ err: error }, 'Failed to deliver WhatsApp message');
      return reply.code(502).send({ error: 'delivery failed' });
    }
    return reply.code(200).send({ status: 'sent' });
  });

  return app;
}

export type App = ReturnType<typeof buildServer>;
