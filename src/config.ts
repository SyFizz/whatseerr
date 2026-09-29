import { z } from 'zod';
import { DEFAULT_OVERVIEW_MAX_LENGTH } from './notifications/format.js';

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

// Docker/Compose often pass unset variables as empty strings: treat them as missing.
const optionalString = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional());

const envSchema = z.object({
  WEBHOOK_SECRET: z.string().min(16, 'WEBHOOK_SECRET must be at least 16 characters long'),
  WHATSAPP_GROUP_JID: optionalString(
    z
      .string()
      .regex(/^[\d-]+@g\.us$/, 'WHATSAPP_GROUP_JID must look like 1234567890-1234567890@g.us'),
  ),
  WHATSAPP_PAIRING_PHONE: optionalString(
    z.string().regex(/^\d{8,15}$/, 'WHATSAPP_PAIRING_PHONE must be digits only, with country code'),
  ),
  LANGUAGE: optionalString(z.enum(['fr', 'en'])).default('fr'),
  HOST: optionalString(z.string()).default('0.0.0.0'),
  PORT: optionalString(z.coerce.number().int().min(1).max(65535)).default(8080),
  LOG_LEVEL: optionalString(z.enum(LOG_LEVELS)).default('info'),
  WHATSAPP_LOG_LEVEL: optionalString(z.enum(LOG_LEVELS)).default('warn'),
  DRY_RUN: optionalString(z.stringbool()).default(false),
  DATA_DIR: optionalString(z.string()).default('./data'),
  DEDUP_WINDOW_MINUTES: optionalString(z.coerce.number().min(0)).default(360),
  QUEUE_MAX_AGE_HOURS: optionalString(z.coerce.number().positive()).default(24),
  SEND_INTERVAL_SECONDS: optionalString(z.coerce.number().min(0)).default(5),
  OVERVIEW_MAX_LENGTH: optionalString(z.coerce.number().int().min(0)).default(
    DEFAULT_OVERVIEW_MAX_LENGTH,
  ),
});

export type Env = z.infer<typeof envSchema>;

export interface Config {
  webhookSecret: string;
  whatsapp: {
    groupJid: string | undefined;
    pairingPhone: string | undefined;
    /** Log level of the Baileys library, kept apart because it is very verbose. */
    logLevel: Env['LOG_LEVEL'];
  };
  /** When true, messages are logged instead of being sent to WhatsApp. */
  dryRun: boolean;
  language: Env['LANGUAGE'];
  /** Maximum synopsis length in messages; 0 hides it. */
  overviewMaxLength: number;
  host: string;
  port: number;
  logLevel: Env['LOG_LEVEL'];
  dataDir: string;
  delivery: {
    /** Same media announced again within this window is dropped (0 disables). */
    dedupWindowMs: number;
    /** Queued messages older than this are dropped. */
    maxAgeMs: number;
    /** Minimum delay between two WhatsApp messages. */
    sendIntervalMs: number;
  };
}

export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    // Never echo received values: they may contain secrets.
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new ConfigError(`Invalid configuration:\n${issues}`);
  }
  const e = result.data;
  return {
    webhookSecret: e.WEBHOOK_SECRET,
    whatsapp: {
      groupJid: e.WHATSAPP_GROUP_JID,
      pairingPhone: e.WHATSAPP_PAIRING_PHONE,
      logLevel: e.WHATSAPP_LOG_LEVEL,
    },
    dryRun: e.DRY_RUN,
    language: e.LANGUAGE,
    overviewMaxLength: e.OVERVIEW_MAX_LENGTH,
    host: e.HOST,
    port: e.PORT,
    logLevel: e.LOG_LEVEL,
    dataDir: e.DATA_DIR,
    delivery: {
      dedupWindowMs: e.DEDUP_WINDOW_MINUTES * 60_000,
      maxAgeMs: e.QUEUE_MAX_AGE_HOURS * 3_600_000,
      sendIntervalMs: e.SEND_INTERVAL_SECONDS * 1_000,
    },
  };
}
