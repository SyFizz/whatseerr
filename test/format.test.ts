import { describe, expect, it } from 'vitest';
import { getMessages } from '../src/i18n/index.js';
import { formatNotification } from '../src/notifications/format.js';
import { seerrPayloadSchema } from '../src/seerr/payload.js';
import { loadSeerrFixture, type SeerrFixture } from './fixtures/index.js';

const fr = getMessages('fr');
const en = getMessages('en');
const payload = (name: SeerrFixture) => seerrPayloadSchema.parse(loadSeerrFixture(name));

describe('formatNotification', () => {
  it('formats an available movie with poster and requester', () => {
    const message = formatNotification(payload('media-available-movie'), fr);
    expect(message?.imageUrl).toMatch(/^https:\/\/image\.tmdb\.org\//);
    expect(message?.text).toContain(fr.movieAvailable);
    expect(message?.text).toContain('*Inception (2010)*');
    expect(message?.text).toContain('Demandé par alice');
  });

  it('formats an available series with its extras', () => {
    const message = formatNotification(payload('media-available-tv'), en);
    expect(message?.text).toContain(en.seriesAvailable);
    expect(message?.text).toContain('Requested Seasons: 1, 2');
    expect(message?.text).toContain('Requested by bob');
  });

  it('answers the Seerr test notification without image', () => {
    const message = formatNotification(payload('test-notification'), fr);
    expect(message).toEqual({ text: fr.testNotification });
  });

  it('ignores notification types that are not forwarded', () => {
    expect(formatNotification(payload('media-pending'), fr)).toBeNull();
  });

  it('shortens long overviews to the configured length', () => {
    const base = payload('media-available-movie');
    const long = { ...base, message: 'word '.repeat(200) };
    const overview = (text: string | undefined) => /\n_(.*)_\n/.exec(text ?? '')?.[1] ?? '';

    const byDefault = overview(formatNotification(long, fr)?.text);
    expect(byDefault.length).toBeLessThanOrEqual(200);
    expect(byDefault).toMatch(/word…$/);

    const custom = overview(formatNotification(long, fr, { overviewMaxLength: 50 })?.text);
    expect(custom.length).toBeLessThanOrEqual(50);
  });

  it('hides the overview when the maximum length is 0', () => {
    const message = formatNotification(payload('media-available-movie'), fr, {
      overviewMaxLength: 0,
    });
    expect(message?.text).not.toContain('Cobb');
    expect(message?.text).toContain('Demandé par alice');
  });

  it('drops non-http image URLs', () => {
    const base = payload('media-available-movie');
    const message = formatNotification({ ...base, image: 'javascript:alert(1)' }, fr);
    expect(message?.imageUrl).toBeUndefined();
  });
});
