import { loadAgent } from '../../../engine/shared/agent-loader.js';
import { createHash } from 'node:crypto';
import { frameworkError } from '../../../engine/shared/framework-error.js';
import type { ConvectionSessionService } from './session-service.js';
import type { ResolvedOutputBudget } from '../../../engine/collaboration/contracts.js';
import type { ConvectionSessionData } from '../infrastructure/session-store.js';
import type { ConvectionRoundKind } from '../domain/session-snapshot.js';
import type { ConvectionRunRepository } from '../infrastructure/run-repository.js';
import { readDiscussionRounds, type DiscussionScope, type DiscussionRound } from './discussion-round-reader.js';

export interface LiveDiscussionView {
  session: ConvectionSessionData;
  round: ConvectionRoundKind;
  runId: string;
  speaker: string;
  draft: string;
  message?: string;
}

export interface CreateDiscussionInput {
  title: string;
  topic: string;
  chairAgentId: string;
  participantAgentIds: string[];
}

export interface CreateDiscussionResult extends CreateDiscussionInput {
  sessionId: string;
}

export interface DiscussionView {
  sessionId: string;
  title: string;
  topic: string;
  chairAgentId: string;
  participantAgentIds: string[];
  messages: Array<{ speaker: string; content: string; timestamp?: number; complete?: boolean }>;
  truncated: boolean;
  empty?: boolean;
  activeRound?: { round: ConvectionRoundKind; runId: string };
  notice?: string;
}

export class ConvectionDiscussionService {
  constructor(
    private readonly dataDir: string,
    private readonly sessions: ConvectionSessionService,
    private readonly live?: (sessionId: string) => LiveDiscussionView | null,
    private readonly runs?: ConvectionRunRepository,
  ) {}

  async listRounds(sessionId: string, scope: DiscussionScope,
    budget: ResolvedOutputBudget, cursor?: string) {
    const session = this.live?.(sessionId)?.session ?? await this.sessions.require(sessionId);
    const rounds = await readDiscussionRounds(this.dataDir, session, scope);
    const active = this.live?.(sessionId);
    includeActive(rounds, active, scope);
    const ordered = rounds.reverse();
    const offset = cursor ? ordered.findIndex(round => round.roundId === cursor) + 1 : 0;
    if (cursor && offset === 0) throw discussionError('CONVECTION_ROUND_CURSOR_INVALID',
      '对流轮次游标无效或已过期');
    const page = ordered.slice(offset, offset + (budget.items ?? 20));
    const statuses = new Map((await this.runs?.history() ?? [])
      .filter(run => run.sessionId === sessionId && run.round === scope)
      .map(run => [run.runId, run.status]));
    return { sessionId, scope, items: page.map(round => ({
      roundId: round.roundId, preciseIdentity: round.preciseIdentity,
      archived: round.archived, messageCount: round.messages.length,
      opening: round.messages[0]?.content.slice(0, 200) ?? '',
      status: active?.round === scope && active.runId === round.roundId
        ? 'running' : statuses.get(round.roundId) ?? 'unknown',
      complete: completion(active?.round === scope && active.runId === round.roundId
        ? 'running' : statuses.get(round.roundId) ?? 'unknown'),
    })), truncated: offset + page.length < ordered.length,
    ...(offset + page.length < ordered.length ? {
      nextCursor: page.at(-1)?.roundId,
    } : {}) };
  }

  async readRound(sessionId: string, roundId: string, scope: DiscussionScope,
    budget: ResolvedOutputBudget) {
    const active = this.live?.(sessionId);
    const session = active?.session ?? await this.sessions.require(sessionId);
    const rounds = await readDiscussionRounds(this.dataDir, session, scope);
    includeActive(rounds, active, scope);
    const round = rounds.find(item => item.roundId === roundId);
    if (!round) throw discussionError('CONVECTION_ROUND_NOT_FOUND', '对流轮次不存在');
    const running = active?.round === scope && active.runId === roundId;
    const selected = round.messages.slice(-(budget.items ?? 20));
    const bounded = boundMessages(selected, budget.textChars ?? 8_000,
      budget.textLines ?? 160);
    const record = await this.runs?.get(sessionId, roundId);
    const status = running ? 'running' : record?.status ?? 'unknown';
    return { sessionId, roundId, scope, preciseIdentity: round.preciseIdentity,
      archived: round.archived, status, complete: completion(status),
      messages: bounded.messages,
      truncated: round.messages.length > selected.length || bounded.truncated,
      ...(running ? { notice: '本轮尚未完成；末条发言可能是未落盘草稿。' } : {}),
    };
  }

  async create(input: CreateDiscussionInput): Promise<CreateDiscussionResult> {
    this.validateMembers(input);
    for (const agentId of [input.chairAgentId, ...input.participantAgentIds]) {
      if (!await loadAgent(this.dataDir, agentId)) throw discussionError(
        'CONVECTION_DISCUSSION_AGENT_NOT_FOUND', '对流会议引用的 Agent 不存在', { agentId },
      );
    }
    const session = await this.sessions.create(input);
    return {
      sessionId: session.id, title: session.title, topic: session.topic,
      chairAgentId: session.chairAgentId,
      participantAgentIds: [...session.participantAgentIds],
    };
  }

  async list(budget: ResolvedOutputBudget, cursor?: string) {
    const sessions = await this.sessions.list();
    const revision = createHash('sha256').update(JSON.stringify(sessions.map(session => [
      session.id, session.updatedAt,
    ]))).digest('hex');
    const offset = readCursor(cursor, revision);
    const limit = budget.items ?? 20;
    const page = sessions.slice(offset, offset + limit);
    const nextOffset = offset + page.length;
    return {
      items: page.map(session => ({ sessionId: session.id, title: session.title,
        topic: session.topic, chairAgentId: session.chairAgentId,
        participantAgentIds: [...session.participantAgentIds],
        messageCount: session.messageCount, updatedAt: session.updatedAt })),
      truncated: nextOffset < sessions.length,
      ...(nextOffset < sessions.length ? {
        nextCursor: Buffer.from(JSON.stringify({ revision, offset: nextOffset })).toString('base64url'),
      } : {}),
    };
  }

  async read(sessionId: string, budget: ResolvedOutputBudget,
    scope: 'public' | 'chair' = 'public'): Promise<DiscussionView> {
    const active = this.live?.(sessionId);
    const session = active?.session ?? await this.sessions.require(sessionId);
    const limit = budget.items ?? 20;
    const source: DiscussionView['messages'] = scope === 'chair'
      ? session.chairMessages.map(message => ({ speaker: message.role, content: message.content }))
      : session.publicMessages.map(message => ({ speaker: message.speaker,
        content: message.content, timestamp: message.timestamp }));
    if (active?.round === scope && active.draft) source.push({
      speaker: active.speaker, content: active.draft, complete: false,
    });
    const selected = source.slice(-limit);
    const bounded = boundMessages(selected, budget.textChars ?? 8_000, budget.textLines ?? 160);
    return {
      sessionId: session.id, title: session.title, topic: session.topic,
      chairAgentId: session.chairAgentId,
      participantAgentIds: [...session.participantAgentIds],
      messages: bounded.messages,
      truncated: source.length > selected.length || bounded.truncated,
      ...(scope === 'chair' ? { empty: source.length === 0 } : {}),
      ...(active ? { activeRound: { round: active.round, runId: active.runId },
        notice: '会议成员尚未完全回复完成；以上是当前快照，末条发言可能被截断。' } : {}),
    };
  }

  private validateMembers(input: CreateDiscussionInput): void {
    const members = input.participantAgentIds;
    if (members.length < 1 || members.length > 12
      || new Set(members).size !== members.length
      || members.includes(input.chairAgentId)) {
      throw discussionError(
        'CONVECTION_DISCUSSION_MEMBER_INVALID',
        '对流会议需要 1–12 个不重复的参与者，主席不能同时作为参与者',
      );
    }
  }
}

function completion(status: string): boolean | null {
  if (status === 'unknown') return null;
  return status === 'completed';
}

function includeActive(rounds: DiscussionRound[], active: LiveDiscussionView | null | undefined,
  scope: DiscussionScope): void {
  if (!active || active.round !== scope) return;
  let round = rounds.find(item => item.roundId === active.runId);
  if (!round) {
    round = { roundId: active.runId, scope, preciseIdentity: true,
      archived: false, messages: active.message
        ? [{ speaker: '人类', content: active.message }] : [] };
    rounds.push(round);
  }
  if (active.draft) round.messages.push({ speaker: active.speaker,
    content: active.draft, complete: false });
}

function readCursor(cursor: string | undefined, revision: string): number {
  if (cursor === undefined) return 0;
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      revision?: unknown; offset?: unknown;
    };
    if (value.revision === revision && Number.isSafeInteger(value.offset)
      && (value.offset as number) >= 0) return value.offset as number;
  } catch { /* Invalid cursors are reported below. */ }
  throw frameworkError({ code: 'CONVECTION_DISCUSSION_CURSOR_INVALID', kind: 'conflict',
    message: '会议目录游标无效或已经过期', source: 'convection.discussions', retryable: false });
}

function boundMessages<T extends { content: string }>(
  messages: T[], maxChars: number, maxLines: number,
): { messages: T[]; truncated: boolean } {
  let chars = 0;
  let lines = 0;
  const result: T[] = [];
  for (const message of [...messages].reverse()) {
    const nextLines = message.content.split('\n').length;
    if (chars + message.content.length > maxChars || lines + nextLines > maxLines) {
      const remainingChars = maxChars - chars;
      const remainingLines = maxLines - lines;
      if (remainingChars > 0 && remainingLines > 0) {
        const content = message.content.split('\n').slice(-remainingLines).join('\n')
          .slice(-remainingChars);
        result.push({ ...message, content });
      }
      return { messages: result.reverse(), truncated: true };
    }
    result.push(message);
    chars += message.content.length;
    lines += nextLines;
  }
  return { messages: result.reverse(), truncated: false };
}

function discussionError(
  code: string, message: string, details?: Record<string, unknown>,
) {
  return frameworkError({ code, kind: 'validation', message,
    source: 'convection.discussions', retryable: false, details });
}
