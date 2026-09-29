import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildServer, isAuthorized, type App } from '../src/http/server.js';
import { getMessages } from '../src/i18n/index.js';
import { createLogger } from '../src/logger.js';
import type { Notifier } from '../src/whatsapp/notifier.js';
import { loadSeerrFixture } from './fixtures/index.js';

const SECRET = 'a-very-long-test-secret';
const AUTH = { authorization: `Bearer ${SECRET}` };

describe('isAuthorized', () => {
  it('accepts only the exact bearer secret', () => {
    expect(isAuthorized(`Bearer ${SECRET}`, SECRET)).toBe(true);
    expect(isAuthorized(SECRET, SECRET)).toBe(false);
    expect(isAuthorized('Bearer wrong', SECRET)).toBe(false);
    expect(isAuthorized(undefined, SECRET)).toBe(false);
  });
});

describe('HTTP server', () => {
  let app: App;
  let send: ReturnType<typeof vi.fn<Notifier['send']>>;
  let getStatus: ReturnType<typeof vi.fn<Notifier['getStatus']>>;

  beforeEach(() => {
    send = vi.fn<Notifier['send']>().mockResolvedValue(undefined);
    getStatus = vi.fn<Notifier['getStatus']>().mockReturnValue({ ready: true, state: 'open' });
    app = buildServer({
      webhookSecret: SECRET,
      messages: getMessages('fr'),
      notifier: { send, getStatus, close: () => Promise.resolve() },
      logger: createLogger('silent'),
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it('exposes a health check', async () => {
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('reports readiness from the notifier', async () => {
    const ready = await app.inject({ method: 'GET', url: '/readyz' });
    expect(ready.statusCode).toBe(200);

    getStatus.mockReturnValue({ ready: false, state: 'waiting-for-pairing' });
    const notReady = await app.inject({ method: 'GET', url: '/readyz' });
    expect(notReady.statusCode).toBe(503);
    expect(notReady.json()).toEqual({ ready: false, state: 'waiting-for-pairing' });
  });

  it('rejects unauthenticated webhooks', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/webhook',
      payload: loadSeerrFixture('media-available-movie') as object,
    });
    expect(res.statusCode).toBe(401);
    expect(send).not.toHaveBeenCalled();
  });

  it('rejects invalid payloads', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/webhook',
      headers: AUTH,
      payload: { hello: 'world' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('forwards MEDIA_AVAILABLE to the notifier', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/webhook',
      headers: AUTH,
      payload: loadSeerrFixture('media-available-movie') as object,
    });
    expect(res.statusCode).toBe(200);
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]?.[0].text).toContain('Inception');
  });

  it('acknowledges but ignores other notification types', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/webhook',
      headers: AUTH,
      payload: loadSeerrFixture('media-pending') as object,
    });
    expect(res.statusCode).toBe(202);
    expect(send).not.toHaveBeenCalled();
  });

  it('returns 502 when delivery fails', async () => {
    send.mockRejectedValueOnce(new Error('socket closed'));
    const res = await app.inject({
      method: 'POST',
      url: '/webhook',
      headers: AUTH,
      payload: loadSeerrFixture('test-notification') as object,
    });
    expect(res.statusCode).toBe(502);
  });
});
