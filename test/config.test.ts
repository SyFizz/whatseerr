import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config.js';

const SECRET = 'a-very-long-test-secret';

describe('loadConfig', () => {
  it('applies defaults when only the secret is set', () => {
    const config = loadConfig({ WEBHOOK_SECRET: SECRET });
    expect(config).toMatchObject({
      webhookSecret: SECRET,
      language: 'fr',
      host: '0.0.0.0',
      port: 8080,
      logLevel: 'info',
      dataDir: './data',
      whatsapp: { groupJid: undefined, pairingPhone: undefined },
    });
  });

  it('treats empty strings as unset', () => {
    const config = loadConfig({ WEBHOOK_SECRET: SECRET, WHATSAPP_GROUP_JID: '', PORT: '' });
    expect(config.whatsapp.groupJid).toBeUndefined();
    expect(config.port).toBe(8080);
  });

  it('parses explicit values', () => {
    const config = loadConfig({
      WEBHOOK_SECRET: SECRET,
      WHATSAPP_GROUP_JID: '120363012345678901@g.us',
      LANGUAGE: 'en',
      PORT: '3000',
    });
    expect(config.whatsapp.groupJid).toBe('120363012345678901@g.us');
    expect(config.language).toBe('en');
    expect(config.port).toBe(3000);
  });

  it('rejects a missing or short secret', () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    expect(() => loadConfig({ WEBHOOK_SECRET: 'short' })).toThrow(/WEBHOOK_SECRET/);
  });

  it('rejects a malformed group JID without echoing the value', () => {
    const run = () => loadConfig({ WEBHOOK_SECRET: SECRET, WHATSAPP_GROUP_JID: 'not-a-jid' });
    expect(run).toThrow(/WHATSAPP_GROUP_JID/);
    expect(run).not.toThrow(/not-a-jid/);
  });
});
