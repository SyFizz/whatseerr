import { mkdir, rm } from 'node:fs/promises';
import {
  Browsers,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  makeWASocket,
  useMultiFileAuthState,
  type AuthenticationState,
  type WASocket,
} from 'baileys';
import type { Logger } from '../logger.js';

export interface AuthStore {
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
}

/** Loads (or creates) the Baileys multi-file auth state stored in `dir`. */
export async function loadAuthStore(dir: string): Promise<AuthStore> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  return useMultiFileAuthState(dir);
}

/** Deletes the stored session so that the next connection asks for a new pairing. */
export async function clearAuthStore(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

export type SocketFactory = (auth: AuthenticationState, logger: Logger) => Promise<WASocket>;

/** Creates the real Baileys socket with settings suited to a notification bot. */
export const createBaileysSocket: SocketFactory = async (auth, logger) => {
  // Never throws: falls back to the version bundled with Baileys when offline.
  const { version } = await fetchLatestBaileysVersion();
  return makeWASocket({
    version,
    logger,
    auth: { creds: auth.creds, keys: makeCacheableSignalKeyStore(auth.keys, logger) },
    browser: Browsers.ubuntu('Chrome'),
    // Stay "offline" so the phone keeps receiving notifications.
    markOnlineOnConnect: false,
    // Skip the full history, but keep Baileys' default initial sync: it carries the LID
    // mappings the session needs to stay stable.
    syncFullHistory: false,
  });
};
