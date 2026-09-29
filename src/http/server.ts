import { createHash, timingSafeEqual } from 'node:crypto';
import Fastify from 'fastify';
import type { Messages } from '../i18n/index.js';
import type { Logger } from '../logger.js';
import { formatNotification } from '../notifications/format.js';
import { seerrPayloadSchema } from '../seerr/payload.js';
import type { Notifier } from '../whatsapp/notifier.js';

export interface ServerDeps {
  webhookSecret: string;
  messages: Messages;
  notifier: Notifier;
  logger: Logger;
}

const sha256 = (value: string) => createHash('sha256').update(value).digest();

/** Constant-time check of the `Authorization: Bearer <secret>` header sent by Seerr. */
export function isAuthorized(header: string | undefined, secret: string): boolean {
  if (!header) return false;
  return timingSafeEqual(sha256(header), sha256(`Bearer ${secret}`));
}

export function buildServer(deps: ServerDeps) {
  const app = Fastify({ loggerInstance: deps.logger, bodyLimit: 256 * 1024 });

  // Silenced: the Docker healthcheck polls it every 30s.
  app.get('/healthz', { logLevel: 'silent' }, () => ({ status: 'ok' }));

  app.post('/webhook', async (request, reply) => {
    if (!isAuthorized(request.headers.authorization, deps.webhookSecret)) {
      return reply.code(401).send({ error: 'unauthorized' });
    }

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

    try {
      await deps.notifier.send(message);
    } catch (error) {
      request.log.error({ err: error }, 'Failed to deliver WhatsApp message');
      return reply.code(502).send({ error: 'delivery failed' });
    }
    return reply.code(200).send({ status: 'sent' });
  });

  return app;
}

export type App = ReturnType<typeof buildServer>;
