import { describe, expect, it } from 'vitest';
import { dedupKey } from '../src/notifications/dedup.js';
import { seerrPayloadSchema } from '../src/seerr/payload.js';
import { loadSeerrFixture } from './fixtures/index.js';

const movie = seerrPayloadSchema.parse(loadSeerrFixture('media-available-movie'));

describe('dedupKey', () => {
  it('identifies the media by type and TMDB id', () => {
    expect(dedupKey(movie)).toBe('movie:tmdb:27205');
    const tv = seerrPayloadSchema.parse(loadSeerrFixture('media-available-tv'));
    expect(dedupKey(tv)).toBe('tv:tmdb:95396');
  });

  it('ignores the 4K flag and the requested seasons', () => {
    const fourK = { ...movie, event: '4K Movie Now Available', extra: [{ name: 'x', value: 'y' }] };
    expect(dedupKey(fourK)).toBe(dedupKey(movie));
  });

  it('falls back to the title when the media section is missing', () => {
    expect(dedupKey({ ...movie, media: null })).toBe('subject:inception (2010)');
    expect(dedupKey({ ...movie, media: null, subject: '  ' })).toBeUndefined();
  });
});
