import { ConfigError, loadConfig } from './config.js';
import { buildServer } from './http/server.js';
import { getMessages } from './i18n/index.js';
import { createLogger } from './logger.js';
import { LogNotifier } from './whatsapp/notifier.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);

  if (!config.whatsapp.groupJid) {
    logger.warn('WHATSAPP_GROUP_JID is not set: notifications cannot be delivered yet');
  }

  const notifier = new LogNotifier(logger);
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
