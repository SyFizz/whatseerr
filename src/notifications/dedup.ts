import type { SeerrPayload } from '../seerr/payload.js';

/**
 * Identifies the media a notification is about, so that repeated announcements can be dropped.
 *
 * Seerr sends one MEDIA_AVAILABLE per request, not per media: a movie requested in HD and 4K, or
 * a series requested season by season, triggers several notifications at once. The 4K flag and the
 * seasons are deliberately ignored: the group only needs to hear about the title once.
 */
export function dedupKey(payload: SeerrPayload): string | undefined {
  const mediaType = payload.media?.media_type.trim();
  const tmdbId = payload.media?.tmdbId?.trim();
  if (mediaType && tmdbId) return `${mediaType}:tmdb:${tmdbId}`;

  // Customised templates may drop the media section: fall back to the title.
  const subject = payload.subject.trim().toLowerCase();
  return subject ? `subject:${subject}` : undefined;
}
