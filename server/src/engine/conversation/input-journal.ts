import fs from 'node:fs/promises';
import path from 'node:path';
import { atomicWriteFile } from '../shared/atomic-io.js';
import { inputError, validateHumanInput, type InputReceipt } from './input-inbox.js';
import type { ContextMessage } from '../shared/types.js';

export interface InputOwner {
  agentId: string;
  sessionId: string;
  runId: string;
}

export interface InputCheckpoint {
  context: ContextMessage[];
  includedIds: string[];
  closed: boolean;
}

export interface InputJournal extends InputOwner {
  version: 1;
  entries: InputReceipt[];
  checkpoint?: InputCheckpoint;
}

// Serializes the entire read-modify-write, not only the final rename. Single-server ownership only.
const writes = new Map<string, Promise<void>>();

function journalFile(dataDir: string, owner: InputOwner): string {
  if (![owner.agentId, owner.sessionId, owner.runId].every(value =>
    typeof value === 'string' && /^[a-zA-Z0-9_-]{1,160}$/.test(value))) {
    throw inputError('INPUT_INVALID', 'validation', '会话或执行标识无效');
  }
  return path.resolve(dataDir, 'agents', owner.agentId, 'sessions', `${owner.sessionId}.inputs`, `${owner.runId}.json`);
}

async function checkPath(dataDir: string, file: string): Promise<void> {
  const root = path.resolve(dataDir);
  let current = root;
  const parts = path.relative(root, file).split(path.sep);
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    let stat;
    try { stat = await fs.lstat(current); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    if (stat.isSymbolicLink() || (i < parts.length - 1 && !stat.isDirectory())) {
      throw inputError('INPUT_PATH_UNSAFE', 'permission', '插话存储路径不能包含链接或非目录父级');
    }
  }
}

function validReceipt(value: unknown, runId: string): value is InputReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  try { validateHumanInput({ id: entry.id, content: entry.content }); }
  catch { return false; }
  return entry.runId === runId && Number.isSafeInteger(entry.sequence) && Number(entry.sequence) > 0
    && typeof entry.receivedAt === 'string' && Number.isFinite(Date.parse(entry.receivedAt));
}

function parseJournal(raw: string, owner: InputOwner): InputJournal {
  let value: unknown;
  try { value = JSON.parse(raw); }
  catch { throw corrupt(); }
  if (!value || typeof value !== 'object') throw corrupt();
  const journal = value as Record<string, unknown>;
  if (journal.version !== 1 || journal.agentId !== owner.agentId
    || journal.sessionId !== owner.sessionId || journal.runId !== owner.runId
    || !Array.isArray(journal.entries) || journal.entries.length > 512) throw corrupt();
  const entries: InputReceipt[] = [];
  const ids = new Set<string>();
  for (const entry of journal.entries) {
    if (!validReceipt(entry, owner.runId) || entry.sequence !== entries.length + 1 || ids.has(entry.id)) throw corrupt();
    ids.add(entry.id);
    entries.push(entry);
  }
  const checkpoint = journal.checkpoint;
  if (checkpoint !== undefined && !validCheckpoint(checkpoint, ids)) throw corrupt();
  return { version: 1, ...owner, entries, ...(checkpoint ? { checkpoint } : {}) };
}

function validCheckpoint(value: unknown, ids: Set<string>): value is InputCheckpoint {
  if (!value || typeof value !== 'object') return false;
  const checkpoint = value as InputCheckpoint;
  return typeof checkpoint.closed === 'boolean' && Array.isArray(checkpoint.includedIds)
    && checkpoint.includedIds.every(id => typeof id === 'string' && ids.has(id))
    && Array.isArray(checkpoint.context) && checkpoint.context.length <= 1_000
    && checkpoint.context.every(validContextMessage);
}

function validContextMessage(value: unknown): value is ContextMessage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const message = value as ContextMessage;
  if (!['assistant', 'user', 'tool'].includes(message.role) || typeof message.content !== 'string') return false;
  if (message.origin !== undefined && !['human', 'framework'].includes(message.origin)) return false;
  if (message.reasoningContent !== undefined && typeof message.reasoningContent !== 'string') return false;
  if (message.toolCallId !== undefined && (message.role !== 'tool' || typeof message.toolCallId !== 'string' || !message.toolCallId)) return false;
  if (message.toolCalls !== undefined && (message.role !== 'assistant' || !Array.isArray(message.toolCalls)
    || !message.toolCalls.every(call => call && typeof call.id === 'string' && !!call.id
      && typeof call.name === 'string' && !!call.name && typeof call.arguments === 'string'))) return false;
  if (message.images !== undefined && (message.role !== 'user' || !Array.isArray(message.images)
    || !message.images.every(image => image && ['id', 'name', 'mimeType', 'dataUrl']
      .every(key => typeof image[key as keyof typeof image] === 'string')))) return false;
  return message.reasoningEnvelope === undefined || (!!message.reasoningEnvelope
    && ['reasoning_details', 'anthropic_thinking'].includes(message.reasoningEnvelope.field)
    && Array.isArray(message.reasoningEnvelope.value));
}

function corrupt() {
  return inputError('INPUT_JOURNAL_CORRUPT', 'io', '插话记录损坏或版本不受支持，原文件已保留');
}

async function readFile(file: string, owner: InputOwner): Promise<InputJournal> {
  let raw: string;
  try { raw = await fs.readFile(file, 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, ...owner, entries: [] };
    throw error;
  }
  return parseJournal(raw, owner);
}

/** Read-only recovery/diagnostics. Reading never activates a runner or replays an input. */
export async function readConversationInputs(dataDir: string, owner: InputOwner): Promise<InputReceipt[]> {
  return (await readInputJournal(dataDir, owner)).entries;
}

export async function readInputJournal(dataDir: string, owner: InputOwner): Promise<InputJournal> {
  const file = journalFile(dataDir, owner);
  await checkPath(dataDir, file);
  return readFile(file, owner);
}

export async function saveInputCheckpoint(dataDir: string, owner: InputOwner, checkpoint: InputCheckpoint): Promise<void> {
  const file = journalFile(dataDir, owner);
  const snapshot = structuredClone(checkpoint);
  const current = (writes.get(file) ?? Promise.resolve()).catch(() => {}).then(async () => {
    await checkPath(dataDir, file);
    const journal = await readFile(file, owner);
    if (!validCheckpoint(snapshot, new Set(journal.entries.map(entry => entry.id)))) throw corrupt();
    journal.checkpoint = snapshot;
    await fs.mkdir(path.dirname(file), { recursive: true });
    await checkPath(dataDir, file);
    await atomicWriteFile(file, JSON.stringify(journal));
  });
  writes.set(file, current);
  try { await current; }
  finally { if (writes.get(file) === current) writes.delete(file); }
}

/** Durable receipts are independent of frontend session snapshots, so final saves cannot erase them. */
export async function appendConversationInput(dataDir: string, owner: InputOwner, receipt: InputReceipt): Promise<void> {
  const identity = { ...owner };
  const entry = { ...receipt };
  const file = journalFile(dataDir, identity);
  if (!validReceipt(entry, identity.runId)) throw inputError('INPUT_INVALID', 'validation', '插话回执无效');
  const previous = writes.get(file) ?? Promise.resolve();
  const current = previous.catch(() => {}).then(() => appendFile(dataDir, file, identity, entry));
  writes.set(file, current);
  try { await current; }
  finally { if (writes.get(file) === current) writes.delete(file); }
}

async function appendFile(dataDir: string, file: string, owner: InputOwner, receipt: InputReceipt): Promise<void> {
  await checkPath(dataDir, file);
  const journal = await readFile(file, owner);
  const existing = journal.entries.find(entry => entry.id === receipt.id);
  if (existing) {
    if (existing.content !== receipt.content || existing.sequence !== receipt.sequence
      || existing.receivedAt !== receipt.receivedAt) {
      throw inputError('INPUT_ID_CONFLICT', 'conflict', '插话回执 ID 冲突');
    }
    return;
  }
  if (receipt.sequence !== journal.entries.length + 1 || journal.entries.length >= 512) {
    throw inputError('INPUT_SEQUENCE_CONFLICT', 'conflict', '插话序号冲突或记录已满');
  }
  journal.entries.push(receipt);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await checkPath(dataDir, file);
  await atomicWriteFile(file, JSON.stringify(journal));
}
