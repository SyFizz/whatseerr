import { describe, expect, it } from 'vitest';
import { shortenOverview } from '../src/notifications/format.js';

const THREE_SENTENCES =
  'A thief steals secrets from dreams. He is offered a last job. ' +
  'To succeed, he must plant an idea in the mind of an heir to a vast business empire.';

describe('shortenOverview', () => {
  it('keeps short overviews untouched, with whitespace normalised', () => {
    expect(shortenOverview('  A short\n synopsis.  ', 200)).toBe('A short synopsis.');
  });

  it('keeps as many whole sentences as fit', () => {
    expect(shortenOverview(THREE_SENTENCES, 70)).toBe(
      'A thief steals secrets from dreams. He is offered a last job.',
    );
  });

  it('cuts at a word boundary when the first sentence is too long', () => {
    const result = shortenOverview(
      'An unusually long first sentence that never seems to end and keeps going on and on',
      40,
    );
    expect(result).toBe('An unusually long first sentence that…');
    expect(result.length).toBeLessThanOrEqual(40);
  });

  it('does not stop at an abbreviation mistaken for a sentence end', () => {
    const result = shortenOverview(
      'Dr. Stephen Strange loses the use of his hands and searches the world for a cure.',
      60,
    );
    expect(result.startsWith('Dr. Stephen Strange loses')).toBe(true);
    expect(result.endsWith('…')).toBe(true);
  });

  it('keeps closing quotes with their sentence', () => {
    expect(shortenOverview('He says "run!" Then he runs far away from the city.', 20)).toBe(
      'He says "run!"',
    );
  });

  it('returns an empty string when the maximum is 0', () => {
    expect(shortenOverview(THREE_SENTENCES, 0)).toBe('');
  });
});
