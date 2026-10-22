import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { WorkflowGraph, WorkflowNode } from '../../../engine/tradewind/foundation/types/workflow.js';
import { getMeetingFileName } from '../../../engine/tradewind/foundation/archive-paths.js';
import type { RunArchiveInput, RunIdentity, WorkflowRunArchive } from '../application/history-port.js';
import { historyError, readJson, readRunGraph, readRunMeta, record, runDirectory } from './history-storage.js';
import { projectArchivedConversation } from './history-archive-conversation.js';

const MAX_ARCHIVE_BYTES = 32 * 1024 * 1024;

/** Only known run artifacts are exposed; callers never supply filesystem paths. */
export async function listHistoryArchives(dataDir: string, identity: RunIdentity,
  graph: WorkflowGraph,
): Promise<WorkflowRunArchive[]> {
  const directory = await runDirectory(dataDir, identity);
  assertDistinctNodeMappings(graph.nodes.filter(item => item.type === 'agent'));
  const output = await metadata(directory, { kind: 'output' }, ['output.json']);
  const items: WorkflowRunArchive[] = [output];
  for (const node of graph.nodes.filter(item => item.type === 'agent')) {
    const ref = { kind: 'node-context' as const, nodeId: node.id };
    items.push(validNodeSegment(node.id) ? await metadata(directory, ref, ['nodes', node.id, 'messages.json'])
      : { ...ref, state: 'missing' });
  }
  const meetings = graph.nodes.filter(item => item.type === 'meeting');
  assertDistinctMeetingMappings(meetings);
  const files = await meetingFiles(directory);
  for (const node of meetings) {
    const rounds = files.flatMap(name => {
      const match = /-(\d+)\.json$/.exec(name);
      const round = match ? Number(match[1]) : NaN;
      return Number.isSafeInteger(round) && round >= 0 && name === getMeetingFileName(node.id, round) ? [round] : [];
    }).sort((a, b) => a - b);
    if (!rounds.length) items.push({ kind: 'meeting', nodeId: node.id, state: 'missing' });
    for (const round of rounds) items.push(await metadata(directory,
      { kind: 'meeting', nodeId: node.id, round }, ['meetings', getMeetingFileName(node.id, round)]));
  }
  return items;
}

export async function readHistoryArchive(dataDir: string, input: RunArchiveInput) {
  assertReadBounds(input);
  await readRunMeta(dataDir, input);
  const graph = await readRunGraph(dataDir, input);
  const segments = archiveSegments(graph, input);
  const directory = await runDirectory(dataDir, input);
  if (await safeArtifactSize(directory, segments) === undefined) throw historyError(
    'TRADEWIND_HISTORY_NOT_FOUND', '本次运行的归档内容不存在或尚未生成');
  const file = path.join(directory, ...segments);
  const value = await readJson(file, MAX_ARCHIVE_BYTES);
  if (!validContent(value, input.kind)) throw historyError('TRADEWIND_HISTORY_CORRUPT', '运行归档内容格式无效');
  const conversation = input.kind !== 'output';
  const text = JSON.stringify(conversation ? projectArchivedConversation(value, input.kind === 'meeting') : value, null, 2);
  const revision = createHash('sha256').update(text).digest('hex');
  if (input.revision !== undefined && input.revision !== revision) throw historyError(
    'TRADEWIND_HISTORY_CHANGED', '归档内容已变化，请重新从 0 读取');
  if (input.offset > text.length) throw historyError('TRADEWIND_HISTORY_INVALID_CURSOR', '归档正文偏移无效');
  const end = Math.min(text.length, input.offset + input.maxChars);
  return { revision, text: text.slice(input.offset, end), totalChars: text.length,
    ...(conversation ? { presentation: 'public-conversation' as const } : {}),
    ...(end < text.length ? { nextOffset: end } : {}) };
}

function archiveSegments(graph: WorkflowGraph, input: RunArchiveInput): string[] {
  if (input.kind === 'output') {
    if (input.nodeId !== undefined || input.round !== undefined) throw invalidArchive();
    return ['output.json'];
  }
  const node = graph.nodes.find(item => item.id === input.nodeId);
  if (!node) throw historyError('TRADEWIND_HISTORY_NOT_FOUND', '节点不属于本次运行图');
  if (input.kind === 'node-context' && node.type === 'agent' && input.round === undefined) {
    assertDistinctNodeMappings(graph.nodes.filter(item => item.type === 'agent'));
    if (!validNodeSegment(node.id)) throw historyError('TRADEWIND_HISTORY_INVALID_PATH', '节点归档路径映射无效');
    return ['nodes', node.id, 'messages.json'];
  }
  if (input.kind === 'meeting' && node.type === 'meeting' && Number.isSafeInteger(input.round) && input.round! >= 0) {
    assertDistinctMeetingMappings(graph.nodes.filter(item => item.type === 'meeting'));
    return ['meetings', getMeetingFileName(node.id, input.round!)];
  }
  throw invalidArchive();
}

async function metadata(directory: string, ref: Omit<WorkflowRunArchive, 'state' | 'sizeBytes'>,
  segments: string[],
): Promise<WorkflowRunArchive> {
  const size = await safeArtifactSize(directory, segments);
  return { ...ref, state: size === undefined ? 'missing' : 'available',
    ...(size === undefined ? {} : { sizeBytes: size }) };
}

/** Check every directory, not only the final file: junctions can otherwise escape a run. */
async function safeArtifactSize(directory: string, segments: string[]): Promise<number | undefined> {
  let current = directory;
  for (let index = 0; index < segments.length; index++) {
    current = path.join(current, segments[index]);
    try {
      const stat = await fs.lstat(current);
      const last = index === segments.length - 1;
      if (stat.isSymbolicLink() || (last ? !stat.isFile() : !stat.isDirectory())) throw historyError(
        'TRADEWIND_HISTORY_INVALID_PATH', '运行归档路径不接受符号链接或异常文件类型');
      if (last) return stat.size;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
  }
}

async function meetingFiles(directory: string): Promise<string[]> {
  const target = path.join(directory, 'meetings');
  try {
    const stat = await fs.lstat(target);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw historyError(
      'TRADEWIND_HISTORY_INVALID_PATH', '会议归档目录类型无效');
    const files: string[] = [];
    for await (const entry of await fs.opendir(target)) {
      if (entry.isSymbolicLink()) throw historyError('TRADEWIND_HISTORY_INVALID_PATH', '会议归档不接受符号链接');
      if (entry.isFile()) files.push(entry.name);
      if (files.length > 10_000) throw historyError('TRADEWIND_HISTORY_TOO_LARGE', '会议归档数量超过读取上限');
    }
    return files;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

function assertDistinctMeetingMappings(nodes: WorkflowNode[]): void {
  const names = new Set<string>();
  for (const node of nodes) {
    const name = getMeetingFileName(node.id, 0).toLowerCase();
    if (names.has(name)) throw historyError('TRADEWIND_HISTORY_INVALID_PATH', '会议节点归档路径存在歧义');
    names.add(name);
  }
}

function validNodeSegment(id: string): boolean {
  return !!id && id !== '.' && id !== '..' && !id.includes('\0') && !/[\\/]/.test(id)
    && path.basename(id) === id && !(process.platform === 'win32' && (id.includes(':') || /[. ]$/.test(id)));
}

function assertDistinctNodeMappings(nodes: WorkflowNode[]): void {
  const names = new Set<string>();
  for (const node of nodes) {
    if (!validNodeSegment(node.id)) continue;
    const name = process.platform === 'win32' ? node.id.toLowerCase() : node.id;
    if (names.has(name)) throw historyError('TRADEWIND_HISTORY_INVALID_PATH', '节点归档路径存在歧义');
    names.add(name);
  }
}

function validContent(value: unknown, kind: RunArchiveInput['kind']): boolean {
  if (kind === 'output') return Array.isArray(value) && value.every(item => record(item) && typeof item.content === 'string');
  if (kind === 'node-context') return Array.isArray(value) && value.every(item => record(item)
    && typeof item.role === 'string' && typeof item.content === 'string');
  const messages = record(value) ? value.publicMessages : value;
  return Array.isArray(messages) && messages.every(item => record(item) && typeof item.content === 'string');
}

function assertReadBounds(input: RunArchiveInput): void {
  if (!Number.isSafeInteger(input.offset) || input.offset < 0 || !Number.isSafeInteger(input.maxChars)
    || input.maxChars < 1 || input.maxChars > 16_384) throw invalidArchive();
}
function invalidArchive() { return historyError('TRADEWIND_HISTORY_INPUT_INVALID', '运行归档查询参数无效'); }
