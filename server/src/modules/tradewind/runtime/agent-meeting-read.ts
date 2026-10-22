import fs from 'node:fs/promises';
import path from 'node:path';
import { activeMeetings } from '../../../engine/tradewind/nodes/meeting.js';
import { getMeetingFileName, getMeetingRoundUsageFileName, getMeetingsDir } from '../../../engine/tradewind/foundation/archive-paths.js';
import { frameworkError } from '../../../engine/shared/framework-error.js';
import { tradewindRunDir } from '../../../services/data-paths.js';
import { getActiveTradewindOrchestrator } from '../../../services/tradewind-execution.js';
import { projectAgentMeetingConversation } from './agent-meeting-view.js';
import { readTokenUsageFile } from '../../../engine/tradewind/execution/token-usage.js';

interface Input { workflowId: string; executionId: string; nodeId: string;
  scope: 'public' | 'chair'; limit: number; round?: number }

export async function readAgentMeetingConversation(dataDir: string, input: Input) {
  const active = getActiveTradewindOrchestrator({ ...input, dataDir });
  const sameExecution = active?.getWorkflowId() === input.workflowId
    && active.getExecutionId() === input.executionId;
  const meeting = sameExecution ? activeMeetings.get(input.nodeId, input.executionId) : undefined;
  if (meeting?.executionId === input.executionId
    && (input.round === undefined || input.round === meeting.session.round)) {
    const session = meeting.session;
    return input.scope === 'chair'
      ? projectAgentMeetingConversation({ ...input, scope: 'chair', round: session.round,
        phase: session.phase, busy: session.busy, messages: session.chairMessages,
        tokenUsage: session.usageRecorder.state })
      : projectAgentMeetingConversation({ ...input, scope: 'public', round: session.round,
        phase: session.phase, busy: session.busy, messages: session.publicMessages,
        streamingCurrent: session.streamingCurrent, tokenUsage: session.usageRecorder.state });
  }
  if (input.scope === 'chair') throw missing('会长私聊未归档，当前会议不可读取');
  return archivedMeeting(dataDir, input);
}

async function archivedMeeting(dataDir: string, input: Input) {
  const runDir = tradewindRunDir(dataDir, input.workflowId, input.executionId);
  const meta = await readJson(path.join(runDir, 'meta.json'));
  if (!record(meta) || meta.workflowId !== input.workflowId
    || meta.executionId !== input.executionId) throw corrupt('会议归档身份不匹配');
  const directory = getMeetingsDir(runDir);
  const round = input.round ?? await latestRound(directory, input.nodeId);
  const raw = await readJson(path.join(directory, getMeetingFileName(input.nodeId, round)));
  if (!Array.isArray(raw) || !raw.every(message => record(message)
    && typeof message.speaker === 'string' && typeof message.content === 'string'
    && typeof message.timestamp === 'number')) throw corrupt('会议归档格式无效');
  const tokenUsage = await readTokenUsageFile(path.join(directory, getMeetingRoundUsageFileName(input.nodeId, round)));
  return projectAgentMeetingConversation({ ...input, scope: 'public', round, phase: 'archived', busy: false,
    messages: raw as Array<{ speaker: string; content: string; timestamp: number }>, tokenUsage });
}

async function latestRound(directory: string, nodeId: string): Promise<number> {
  let entries: string[];
  try { entries = await fs.readdir(directory); }
  catch (error) { if (isMissing(error)) throw missing('会议归档不存在'); throw error; }
  const prefix = getMeetingFileName(nodeId, 0).slice(0, -6);
  const rounds = entries.flatMap(name => {
    if (!name.startsWith(prefix) || !name.endsWith('.json')) return [];
    const raw = name.slice(prefix.length, -5);
    return /^\d+$/.test(raw) ? [Number(raw)] : [];
  });
  if (!rounds.length) throw missing('会议归档不存在');
  return Math.max(...rounds);
}

async function readJson(file: string): Promise<unknown> {
  let raw: string;
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw corrupt('会议归档不是常规文件');
    raw = await fs.readFile(file, 'utf8');
  } catch (error) { if (isMissing(error)) throw missing('会议归档不存在'); throw error; }
  try { return JSON.parse(raw) as unknown; }
  catch (error) { throw corrupt('会议归档 JSON 损坏', error); }
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
function missing(message: string) {
  return frameworkError({ code: 'TRADEWIND_MEETING_RECORD_NOT_FOUND', kind: 'not_found',
    message, source: 'tradewind.meeting.read', retryable: false });
}
function corrupt(message: string, cause?: unknown) {
  return frameworkError({ code: 'TRADEWIND_MEETING_RECORD_INVALID', kind: 'internal',
    message, source: 'tradewind.meeting.read', retryable: false },
  cause === undefined ? undefined : { cause });
}
