import type { WASocket } from 'baileys';
import type { Logger } from '../logger.js';

export interface GroupSummary {
  jid: string;
  name: string;
  participants: number;
}

export type GroupSource = Pick<WASocket, 'groupFetchAllParticipating'>;

/** Groups the paired account belongs to, sorted by name. Community parents are skipped: they cannot receive messages. */
export async function listGroups(socket: GroupSource): Promise<GroupSummary[]> {
  const groups = await socket.groupFetchAllParticipating();
  return Object.values(groups)
    .filter((group) => !group.isCommunity)
    .map((group) => ({
      jid: group.id,
      name: group.subject,
      participants: group.size ?? group.participants.length,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function formatGroupList(groups: GroupSummary[]): string {
  if (groups.length === 0) {
    return '\nThis WhatsApp account is not a member of any group yet: add it to the target group.\n\n';
  }
  const width = Math.max(...groups.map((group) => group.jid.length));
  const lines = groups.map(
    (group) => `  ${group.jid.padEnd(width)}  ${group.name} (${group.participants} members)`,
  );
  return (
    '\nWhatsApp groups of this account. Set WHATSAPP_GROUP_JID to the target one and restart:\n' +
    `${lines.join('\n')}\n\n`
  );
}

export interface ReportGroupsOptions {
  groupJid: string | undefined;
  logger: Logger;
  print: (text: string) => void;
}

/**
 * Run when WhatsApp connects: prints the available groups when no target is configured,
 * otherwise checks that the account is still a member of the target group.
 */
export async function reportGroups(
  socket: GroupSource,
  options: ReportGroupsOptions,
): Promise<void> {
  const { groupJid, logger, print } = options;
  const groups = await listGroups(socket);

  if (!groupJid) {
    print(formatGroupList(groups));
    return;
  }
  const target = groups.find((group) => group.jid === groupJid);
  if (target) {
    logger.info({ group: target.name }, 'Target WhatsApp group found');
  } else {
    logger.warn(
      'This WhatsApp account is not a member of WHATSAPP_GROUP_JID: messages will fail. ' +
        'Add the account to the group or fix the JID (GET /groups lists them).',
    );
  }
}
