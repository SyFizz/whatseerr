import { join } from 'node:path';
import { ConfigError, loadConfig, type Config } from './config.js';
import { buildServer } from './http/server.js';
import { getMessages } from './i18n/index.js';
import { createLogger, type Logger } from './logger.js';
import { Outbox } from './notifications/outbox.js';
import { FileOutboxStore } from './notifications/outbox-store.js';
import { BaileysNotifier } from './whatsapp/baileys-notifier.js';
import { WhatsAppConnection } from './whatsapp/connection.js';
import { listGroups, reportGroups, type GroupSummary } from './whatsapp/groups.js';
import { LogNotifier, type Notifier } from './whatsapp/notifier.js';

interface WhatsAppServices {
  notifier: Notifier;
  listGroups?: () => Promise<GroupSummary[]>;
  /** Registers a callback run each time WhatsApp (re)connects. */
  onReady: (listener: () => void) => void;
}

function createWhatsAppServices(config: Config, logger: Logger): WhatsAppServices {
  if (config.dryRun) {
    logger.warn('DRY_RUN is enabled: messages are logged, not sent to WhatsApp');
    return {
      notifier: new LogNotifier(logger),
      onReady: (listener) => {
        listener();
      },
    };
  }
  if (!config.whatsapp.groupJid) {
    logger.warn('WHATSAPP_GROUP_JID is not set: notifications cannot be delivered yet');
  }

  const connection = new WhatsAppConnection({
    authDir: join(config.dataDir, 'auth'),
    pairingPhone: config.whatsapp.pairingPhone,
    logger: logger.child({ module: 'whatsapp' }),
    baileysLogger: logger.child({ module: 'baileys' }, { level: config.whatsapp.logLevel }),
  });
  connection.onOpen((socket) =>
    reportGroups(socket, {
      groupJid: config.whatsapp.groupJid,
      logger,
      print: (text) => process.stdout.write(text),
    }),
  );
  connection.start();

  return {
    notifier: new BaileysNotifier({ connection, groupJid: config.whatsapp.groupJid, logger }),
    listGroups: async () => listGroups(await connection.waitUntilOpen(10_000)),
    onReady: (listener) => {
      connection.onOpen(listener);
    },
  };
}

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);

  const { notifier, listGroups, onReady } = createWhatsAppServices(config, logger);
  const outbox = await Outbox.open({
    notifier,
    store: new FileOutboxStore(join(config.dataDir, 'outbox.json'), logger),
    logger: logger.child({ module: 'outbox' }),
    ...config.delivery,
  });
  onReady(() => {
    outbox.retryNow();
  });
  outbox.start();

  const server = buildServer({
    webhookSecret: config.webhookSecret,
    messages: getMessages(config.language),
    notifier,
    outbox,
    listGroups,
    logger,
  });

  const shutdown = async (signal: NodeJS.Signals) => {
    logger.info({ signal }, 'Shutting down');
    await server.close();
    await outbox.stop();
    await notifier.close();
    process.exit(0);
  };
  process.once('SIGTERM', (signal) => void shutdown(signal));
  process.once('SIGINT', (signal) => void shutdown(signal));

  await server.listen({ host: config.host, port: config.port });
}

main().catch((error: unknown) => {
  if (error instanceof ConfigError) {
    process.stderr.write(`${error.message}\n`);
  } else {
    process.stderr.write(
      `Fatal error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    );
  }
  process.exit(1);
});
