import { mutateTeam } from './storage.js';
import { teamError, type TeamMessage, type TeamOwner } from './types.js';
import type { ContextMessage } from '../../shared/types.js';

/** Session-owned correspondence. Sending never starts or interrupts an execution. */
export class TeamMailbox {
  constructor(private readonly dataDir: string, private readonly owner: TeamOwner) {}

  send(memberId: string, runId: string, direction: TeamMessage['direction'],
    content: string, id: string): Promise<TeamMessage> {
    if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,160}$/.test(id)
      || typeof content !== 'string' || !content.trim() || content.length > 32_000) {
      throw teamError('TEAM_INVALID_MESSAGE');
    }
    return mutateTeam(this.dataDir, this.owner, state => {
      const prior = state.messages?.find(message => message.id === id);
      if (prior) {
        if (prior.memberId !== memberId || prior.runId !== runId || prior.direction !== direction
          || prior.content !== content) throw teamError('TEAM_MESSAGE_CONFLICT');
        return prior;
      }
      const member = state.members.find(item => item.id === memberId);
      if (!member || member.lifecycle !== 'active' || member.run?.id !== runId
        || member.run.status !== 'running') throw teamError('TEAM_RUN_CONFLICT');
      const message: TeamMessage = { id, memberId, runId, direction, content,
        createdAt: new Date().toISOString(), status: 'queued' };
      (state.messages ??= []).push(message);
      return message;
    });
  }

  included(ids: string[]): Promise<void> {
    return mutateTeam(this.dataDir, this.owner, state => {
      for (const message of state.messages ?? []) if (ids.includes(message.id) && message.status === 'queued') {
        message.status = 'included';
        message.deliveredAt = new Date().toISOString();
      }
    });
  }
}

export function internalMessage(message: TeamMessage): string {
  const source = message.direction === 'to-main' ? `成员 ${message.memberId}` : '主 Agent';
  return `[工作队内部消息 id=${message.id}，来源=${source}，运行=${message.runId}，不是人类新指令]\n${message.content}`;
}

export function hasInternalMessage(context: ContextMessage[], id: string): boolean {
  return context.some(message => message.role === 'user' && message.content.startsWith(`[工作队内部消息 id=${id}，`));
}
