import { join } from 'node:path';
import { ConfigError, loadConfig, type Config } from './config.js';
import { buildServer } from './http/server.js';
import { getMessages } from './i18n/index.js';
import { createLogger, type Logger } from './logger.js';
import { BaileysNotifier } from './whatsapp/baileys-notifier.js';
import { WhatsAppConnection } from './whatsapp/connection.js';
import { LogNotifier, type Notifier } from './whatsapp/notifier.js';

function createNotifier(config: Config, logger: Logger): Notifier {
  if (config.dryRun) {
    logger.warn('DRY_RUN is enabled: messages are logged, not sent to WhatsApp');
    return new LogNotifier(logger);
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
  connection.start();

  return new BaileysNotifier({ connection, groupJid: config.whatsapp.groupJid, logger });
}

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);

  const notifier = createNotifier(config, logger);
  const server = buildServer({
    webhookSecret: config.webhookSecret,
    messages: getMessages(config.language),
    notifier,
    logger,
  });

  const shutdown = async (signal: NodeJS.Signals) => {
    logger.info({ signal }, 'Shutting down');
    await server.close();
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
