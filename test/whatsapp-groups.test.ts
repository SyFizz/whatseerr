import type { GroupMetadata } from 'baileys';
import { describe, expect, it, vi } from 'vitest';
import { createLogger } from '../src/logger.js';
import {
  formatGroupList,
  listGroups,
  reportGroups,
  type GroupSource,
} from '../src/whatsapp/groups.js';

const group = (
  id: string,
  subject: string,
  extra: { size?: number; isCommunity?: boolean } = {},
): GroupMetadata => ({
  id,
  owner: undefined,
  subject,
  participants: [],
  ...extra,
});

const source = (...groups: GroupMetadata[]): GroupSource => ({
  groupFetchAllParticipating: () =>
    Promise.resolve(Object.fromEntries(groups.map((g) => [g.id, g]))),
});

const MOVIES = group('111-111@g.us', 'Movie night', { size: 12 });
const FAMILY = group('222-222@g.us', 'Family', { size: 4 });
const COMMUNITY = group('333-333@g.us', 'Neighbourhood', { isCommunity: true });

describe('listGroups', () => {
  it('returns groups sorted by name, without community parents', async () => {
    await expect(listGroups(source(MOVIES, FAMILY, COMMUNITY))).resolves.toEqual([
      { jid: '222-222@g.us', name: 'Family', participants: 4 },
      { jid: '111-111@g.us', name: 'Movie night', participants: 12 },
    ]);
  });
});

describe('formatGroupList', () => {
  it('lists JIDs with names and tells how to configure the target', () => {
    const text = formatGroupList([{ jid: '111-111@g.us', name: 'Movie night', participants: 12 }]);
    expect(text).toContain('WHATSAPP_GROUP_JID');
    expect(text).toContain('111-111@g.us  Movie night (12 members)');
  });

  it('explains what to do when the account has no group', () => {
    expect(formatGroupList([])).toContain('not a member of any group');
  });
});

describe('reportGroups', () => {
  const logger = createLogger('silent');

  it('prints the groups when no target is configured', async () => {
    const print = vi.fn<(text: string) => void>();
    await reportGroups(source(MOVIES), { groupJid: undefined, logger, print });
    expect(print).toHaveBeenCalledWith(expect.stringContaining('111-111@g.us'));
  });

  it('warns when the account is not a member of the target group', async () => {
    const print = vi.fn<(text: string) => void>();
    const warn = vi.spyOn(logger, 'warn');
    await reportGroups(source(MOVIES), { groupJid: '999-999@g.us', logger, print });
    expect(warn).toHaveBeenCalledOnce();
    expect(print).not.toHaveBeenCalled();
  });
});
