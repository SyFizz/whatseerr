import { pino, type Logger, type LevelWithSilent } from 'pino';

export type { Logger };

export function createLogger(level: LevelWithSilent): Logger {
  return pino({
    level,
    redact: {
      paths: [
        'req.headers.authorization',
        'headers.authorization',
        'webhookSecret',
        '*.webhookSecret',
      ],
      censor: '[REDACTED]',
    },
  });
}
