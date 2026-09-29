import { readFileSync } from 'node:fs';

export type SeerrFixture =
  'media-available-movie' | 'media-available-tv' | 'media-pending' | 'test-notification';

export function loadSeerrFixture(name: SeerrFixture): unknown {
  const url = new URL(`./seerr/${name}.json`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')) as unknown;
}
