import { DisconnectReason } from 'baileys';
import { describe, expect, it } from 'vitest';
import { backoffDelay, disconnectAction, statusCodeOf } from '../src/whatsapp/policy.js';

describe('disconnectAction', () => {
  it.each([
    [DisconnectReason.restartRequired, 'reconnect-now'],
    [DisconnectReason.loggedOut, 'reset-session'],
    [DisconnectReason.multideviceMismatch, 'reset-session'],
    [DisconnectReason.connectionReplaced, 'stop'],
    [DisconnectReason.forbidden, 'stop'],
    [DisconnectReason.connectionLost, 'reconnect'],
    [DisconnectReason.badSession, 'reconnect'],
    [undefined, 'reconnect'],
  ] as const)('maps status %s to %s', (statusCode, action) => {
    expect(disconnectAction(statusCode)).toBe(action);
  });
});

describe('backoffDelay', () => {
  it('doubles from 1s and caps at 60s', () => {
    expect([0, 1, 2, 3].map((attempt) => backoffDelay(attempt))).toEqual([1000, 2000, 4000, 8000]);
    expect(backoffDelay(20)).toBe(60_000);
  });
});

describe('statusCodeOf', () => {
  it('reads the Boom status code and ignores anything else', () => {
    expect(statusCodeOf({ output: { statusCode: 401 } })).toBe(401);
    expect(statusCodeOf(new Error('boom'))).toBeUndefined();
    expect(statusCodeOf(undefined)).toBeUndefined();
    expect(statusCodeOf({ output: { statusCode: '401' } })).toBeUndefined();
  });
});
