import type { Messages } from '../i18n/index.js';
import { NotificationType, type SeerrPayload } from '../seerr/payload.js';

export interface OutgoingMessage {
  /** WhatsApp-flavoured markdown (`*bold*`, `_italic_`). Used as the image caption when an image is set. */
  text: string;
  imageUrl?: string | undefined;
}

export interface FormatOptions {
  /** Maximum synopsis length in characters; 0 hides the synopsis. */
  overviewMaxLength?: number;
}

export const DEFAULT_OVERVIEW_MAX_LENGTH = 200;

/** Sentences, keeping their final punctuation and closing quotes. */
const SENTENCE = /[^.!?…]+(?:[.!?…]+["'»”)\]]*|$)/g;

/**
 * Shortens a synopsis to at most `max` characters, preferring whole sentences.
 * Falls back to a cut at a word boundary when the sentences kept would be too short
 * (a long first sentence, or an abbreviation such as "Dr." mistaken for a sentence end).
 */
export function shortenOverview(overview: string, max: number): string {
  const text = overview.replace(/\s+/g, ' ').trim();
  if (max <= 0) return '';
  if (text.length <= max) return text;

  let kept = '';
  for (const sentence of text.match(SENTENCE) ?? []) {
    const candidate = `${kept} ${sentence.trim()}`.trim();
    if (candidate.length > max) break;
    kept = candidate;
  }
  if (kept.length >= max / 3) return kept;

  const cut = text.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(' ');
  const words = lastSpace > max / 2 ? cut.slice(0, lastSpace) : cut;
  return `${words.replace(/[\s,;:.–-]+$/, '')}…`;
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

function formatMediaAvailable(
  payload: SeerrPayload,
  messages: Messages,
  overviewMaxLength: number,
): OutgoingMessage {
  const lines = [heading(payload, messages)];
  if (payload.subject) lines.push('', `*${payload.subject.trim()}*`);

  for (const { name, value } of payload.extra ?? []) {
    if (value.trim()) lines.push(`${name}: ${value.trim()}`);
  }

  const overview = shortenOverview(payload.message ?? '', overviewMaxLength);
  if (overview) lines.push('', `_${overview}_`);

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
  options: FormatOptions = {},
): OutgoingMessage | null {
  switch (payload.notification_type) {
    case NotificationType.MediaAvailable:
      return formatMediaAvailable(
        payload,
        messages,
        options.overviewMaxLength ?? DEFAULT_OVERVIEW_MAX_LENGTH,
      );
    case NotificationType.TestNotification:
      return { text: messages.testNotification };
    default:
      return null;
  }
}
