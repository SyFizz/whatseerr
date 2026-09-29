import { z } from 'zod';

/**
 * Seerr webhook payload, as produced by the default JSON template of the
 * Webhook notification agent. Every templated value is a string, and optional
 * sections (`media`, `request`, ...) are `null` or absent when not relevant.
 * The schema is intentionally lenient: unknown keys are kept, so a customised
 * template does not break parsing.
 */
export const NotificationType = {
  MediaAvailable: 'MEDIA_AVAILABLE',
  TestNotification: 'TEST_NOTIFICATION',
} as const;

const mediaSchema = z.looseObject({
  media_type: z.string(),
  tmdbId: z.string().optional(),
  tvdbId: z.string().optional(),
  status: z.string().optional(),
  status4k: z.string().optional(),
});

const requestSchema = z.looseObject({
  request_id: z.string().optional(),
  requestedBy_username: z.string().optional(),
});

const extraSchema = z.object({
  name: z.string(),
  value: z.string(),
});

export const seerrPayloadSchema = z.looseObject({
  notification_type: z.string().min(1),
  event: z.string().optional(),
  subject: z.string().default(''),
  message: z.string().optional(),
  image: z.string().optional(),
  media: mediaSchema.nullish(),
  request: requestSchema.nullish(),
  extra: z.array(extraSchema).nullish(),
});

export type SeerrPayload = z.infer<typeof seerrPayloadSchema>;
