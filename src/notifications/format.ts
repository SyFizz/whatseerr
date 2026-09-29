import type { Messages } from '../i18n/index.js';
import { NotificationType, type SeerrPayload } from '../seerr/payload.js';

export interface OutgoingMessage {
  /** WhatsApp-flavoured markdown (`*bold*`, `_italic_`). Used as the image caption when an image is set. */
  text: string;
  imageUrl?: string | undefined;
}

const MAX_OVERVIEW_LENGTH = 400;

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1).trimEnd()}…`;
}

function isHttpUrl(value: string | undefined): value is string {
  if (!value) return false;
  try {
    const { protocol } = new URL(value);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

function heading(payload: SeerrPayload, messages: Messages): string {
  switch (payload.media?.media_type) {
    case 'movie':
      return messages.movieAvailable;
    case 'tv':
      return messages.seriesAvailable;
    default:
      return messages.mediaAvailable;
  }
}

function formatMediaAvailable(payload: SeerrPayload, messages: Messages): OutgoingMessage {
  const lines = [heading(payload, messages)];
  if (payload.subject) lines.push('', `*${payload.subject.trim()}*`);

  for (const { name, value } of payload.extra ?? []) {
    if (value.trim()) lines.push(`${name}: ${value.trim()}`);
  }

  const overview = payload.message?.trim();
  if (overview) lines.push('', `_${truncate(overview, MAX_OVERVIEW_LENGTH)}_`);

  const username = payload.request?.requestedBy_username?.trim();
  if (username) lines.push('', messages.requestedBy(username));

  const message: OutgoingMessage = { text: lines.join('\n') };
  if (isHttpUrl(payload.image)) message.imageUrl = payload.image;
  return message;
}

/**
 * Turns a Seerr webhook payload into the WhatsApp message to send,
 * or `null` when the notification type is not forwarded.
 */
export function formatNotification(
  payload: SeerrPayload,
  messages: Messages,
): OutgoingMessage | null {
  switch (payload.notification_type) {
    case NotificationType.MediaAvailable:
      return formatMediaAvailable(payload, messages);
    case NotificationType.TestNotification:
      return { text: messages.testNotification };
    default:
      return null;
  }
}
