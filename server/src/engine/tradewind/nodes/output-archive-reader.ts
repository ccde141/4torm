import fs from 'node:fs/promises';
import path from 'node:path';
import type { ContextMessage } from '../../shared/types.js';

export interface OutputNodeHistory { nodeId: string; label: string; messages: ContextMessage[] }
export interface OutputMeetingHistory { fileName: string; messages: Array<{ speaker?: string; content: string }> }

export async function readOutputNodeHistories(
  runDir: string, labels: Record<string, string>,
): Promise<OutputNodeHistory[]> {
  const directory = path.join(runDir, 'nodes');
  const histories: OutputNodeHistory[] = [];
  for (const nodeId of await entries(directory)) {
    let value: unknown;
    try { value = JSON.parse(await fs.readFile(path.join(directory, nodeId, 'messages.json'), 'utf8')); }
    catch (error) { if (missing(error)) continue; throw error; }
    if (!Array.isArray(value) || !value.every(message => record(message)
      && typeof message.role === 'string' && typeof message.content === 'string')) {
      throw new Error('节点归档记录格式无效');
    }
    histories.push({ nodeId, label: labels[nodeId] || nodeId, messages: value as ContextMessage[] });
  }
  return histories;
}

export async function readOutputMeetings(runDir: string): Promise<OutputMeetingHistory[]> {
  const directory = path.join(runDir, 'meetings');
  const meetings: OutputMeetingHistory[] = [];
  for (const file of await entries(directory)) {
    // 用量侧文件与会议记录共处目录，不能作为会议消息解释。
    if (!file.endsWith('.json') || file.endsWith('-usage.json')) continue;
    const value: unknown = JSON.parse(await fs.readFile(path.join(directory, file), 'utf8'));
    const fileName = file.slice(0, -5);
    if (Array.isArray(value)) meetings.push({ fileName, messages: messages(value) });
    else if (record(value) && Array.isArray(value.publicMessages)) {
      meetings.push({ fileName, messages: messages(value.publicMessages) });
      if (value.chairMessages !== undefined) {
        meetings.push({ fileName: `${fileName}（会长私聊）`, messages: messages(value.chairMessages) });
      }
    } else throw new Error('会议归档记录格式无效');
  }
  return meetings;
}

function messages(value: unknown): OutputMeetingHistory['messages'] {
  if (!Array.isArray(value) || !value.every(message => record(message)
    && typeof message.content === 'string')) throw new Error('会议归档消息格式无效');
  return value.map(message => ({ content: message.content,
    speaker: typeof message.speaker === 'string' ? message.speaker
      : typeof message.role === 'string' ? message.role : undefined }));
}

async function entries(directory: string): Promise<string[]> {
  try { return (await fs.readdir(directory)).sort(); }
  catch (error) { if (missing(error)) return []; throw error; }
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function missing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
