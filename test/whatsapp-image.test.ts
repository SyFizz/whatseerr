import { describe, expect, it } from 'vitest';
import { fetchImage } from '../src/whatsapp/image.js';

const respond =
  (body: string | null, init: ResponseInit): typeof fetch =>
  () =>
    Promise.resolve(new Response(body, init));

describe('fetchImage', () => {
  it('returns the image bytes', async () => {
    const image = await fetchImage('https://example.com/p.jpg', {
      fetchImpl: respond('jpeg-bytes', { headers: { 'content-type': 'image/jpeg' } }),
    });
    expect(image.toString()).toBe('jpeg-bytes');
  });

  it('rejects HTTP errors', async () => {
    const fetchImpl = respond(null, { status: 404 });
    await expect(fetchImage('https://example.com/p.jpg', { fetchImpl })).rejects.toThrow(/404/);
  });

  it('rejects non-image content', async () => {
    const fetchImpl = respond('<html>', { headers: { 'content-type': 'text/html' } });
    await expect(fetchImage('https://example.com/p.jpg', { fetchImpl })).rejects.toThrow(
      /content type/,
    );
  });

  it('rejects images larger than the limit', async () => {
    const fetchImpl = respond('x'.repeat(20), { headers: { 'content-type': 'image/png' } });
    await expect(
      fetchImage('https://example.com/p.jpg', { fetchImpl, maxBytes: 10 }),
    ).rejects.toThrow(/exceeds/);
  });
});
