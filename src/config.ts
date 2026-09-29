import { z } from 'zod';

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
  DATA_DIR: optionalString(z.string()).default('./data'),
});

export type Env = z.infer<typeof envSchema>;

export interface Config {
  webhookSecret: string;
  whatsapp: {
    groupJid: string | undefined;
    pairingPhone: string | undefined;
  };
  language: Env['LANGUAGE'];
  host: string;
  port: number;
  logLevel: Env['LOG_LEVEL'];
  dataDir: string;
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
    },
    language: e.LANGUAGE,
    host: e.HOST,
    port: e.PORT,
    logLevel: e.LOG_LEVEL,
    dataDir: e.DATA_DIR,
  };
}
