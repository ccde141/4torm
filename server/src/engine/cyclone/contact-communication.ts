import path from 'node:path';
import type { ToolCallOutcome } from '../shared/react/native-loop.js';
import { frameworkError } from '../shared/framework-error.js';
import { createContactCommunication, mutateContactCommunication, readContactCommunication,
  type ContactCommunication, type ContactPartyKind } from './contact-communication-store.js';

export { readContactCommunication, recoverCycloneContacts, subscribeContactCommunications,
  type ContactCommunication } from './contact-communication-store.js';
export const CONTACT_WINDOW_MS = 30_000;
export interface ContactEndpoint {
  id: string;
  title: string;
  kind: ContactPartyKind;
  tryAcquire(): Promise<(() => void) | null>;
  execute(signal: AbortSignal, contactId: string): Promise<ToolCallOutcome>;
}
export interface ContactCommunicationInput {
  dataDir: string;
  workshopId: string;
  fromSeatId: string;
  fromTitle: string;
  sourceKind?: ContactPartyKind;
  signal?: AbortSignal;
}
/** Framework/test timing dependency; it is never part of a model tool schema. */
export interface ContactTiming { admissionMs?: number; replyMs?: number; pollMs?: number }
const active = new Map<string, { dataDir: string; controller: AbortController }>();
const tasks = new Map<Promise<unknown>, string>();
const persistenceFailures = new Map<string, unknown>();

export function runContactCommunication(
  input: ContactCommunicationInput, endpoint: ContactEndpoint, timing: ContactTiming = {},
): Promise<ToolCallOutcome> {
  return track(input.dataDir, communicate(input, endpoint, timing));
}

async function communicate(
  input: ContactCommunicationInput, endpoint: ContactEndpoint, timing: ContactTiming,
): Promise<ToolCallOutcome> {
  const controller = new AbortController();
  const abort = () => controller.abort(input.signal?.reason);
  input.signal?.addEventListener('abort', abort, { once: true });
  if (input.signal?.aborted) abort();
  const record = await createContactCommunication(input.dataDir, {
    workshopId: input.workshopId, sourceId: input.fromSeatId, sourceKind: input.sourceKind ?? 'seat',
    sourceTitle: input.fromTitle, targetId: endpoint.id, targetKind: endpoint.kind, targetTitle: endpoint.title,
    admissionDeadlineAt: new Date(Date.now() + (timing.admissionMs ?? CONTACT_WINDOW_MS)).toISOString(),
  }).catch(error => { input.signal?.removeEventListener('abort', abort); throw error; });
  const key = recordKey(input.dataDir, record);
  active.set(key, { dataDir: input.dataDir, controller });
  let handedOff = false;
  try {
    while (!controller.signal.aborted && Date.now() < Date.parse(record.admissionDeadlineAt)) {
      const release = await endpoint.tryAcquire();
      if (!release) { await pause(timing.pollMs ?? 50, controller.signal); continue; }
      let admitted: ContactCommunication;
      try {
        admitted = await mutateContactCommunication(input.dataDir, record.workshopId, record.id, current => {
          if (current.status !== 'waiting' || controller.signal.aborted
            || Date.now() >= Date.parse(current.admissionDeadlineAt)) return current;
          const now = new Date().toISOString();
          return { ...current, status: 'running', delivered: true, acceptedAt: now, updatedAt: now };
        }, controller.signal);
      } catch (error) { release(); throw error; }
      if (!admitted.delivered) { release(); break; }
      // Delivery transfers ownership to the receiver. A later caller stop only
      // stops waiting; it cannot label committed work as undelivered or resend it.
      input.signal?.removeEventListener('abort', abort);
      handedOff = true;
      const completion = track(input.dataDir, complete(input, admitted, endpoint, controller.signal)
        .finally(() => { release(); active.delete(key); }));
      void completion.catch(error => { persistenceFailures.set(key, error); });
      return await waitForReply(completion, timing.replyMs ?? CONTACT_WINDOW_MS, input.signal)
        ?? communicationOutcome(admitted);
    }
    const withdrawn = await mutateContactCommunication(input.dataDir, record.workshopId, record.id, current => {
      if (current.status !== 'waiting') return current;
      return { ...current, status: controller.signal.aborted ? 'aborted' : 'busy', delivered: false,
        updatedAt: new Date().toISOString(), error: controller.signal.aborted
          ? '联络在接入前已撤回，不会稍后投递' : '目标忙线，30秒内未能接入；本次已撤回，不会稍后投递' };
    });
    return communicationOutcome(withdrawn);
  } catch (error) {
    if (handedOff) throw error;
    const failed = await mutateContactCommunication(input.dataDir, record.workshopId, record.id, current => ({
      ...current, status: controller.signal.aborted ? 'aborted' : 'failed', delivered: false,
      updatedAt: new Date().toISOString(), error: error instanceof Error ? error.message.slice(0, 1000) : '联络未能接入',
    }));
    return communicationOutcome(failed);
  } finally {
    input.signal?.removeEventListener('abort', abort);
    if (!handedOff) active.delete(key);
  }
}

async function complete(
  input: ContactCommunicationInput, record: ContactCommunication, endpoint: ContactEndpoint, signal: AbortSignal,
): Promise<ToolCallOutcome> {
  let outcome: ToolCallOutcome;
  try { outcome = await endpoint.execute(signal, record.id); }
  catch (error) { outcome = { ok: false, result: error instanceof Error ? error.message : '联络执行失败' }; }
  const finished = await mutateContactCommunication(input.dataDir, record.workshopId, record.id, current => ({
    ...current, status: signal.aborted ? 'aborted' : outcome.ok ? 'completed' : 'failed',
    updatedAt: new Date().toISOString(), ...(outcome.ok ? { response: outcome.result } : { error: outcome.result.slice(0, 1000) }),
  }));
  return communicationOutcome(finished);
}

function communicationOutcome(record: ContactCommunication): ToolCallOutcome {
  return { ok: record.status === 'completed' || record.status === 'running',
    result: JSON.stringify({ contactId: record.id, status: record.status, delivered: record.delivered,
      ...(record.response ? { reply: record.response.slice(0, 2000),
        ...(record.response.length > 2000 ? { nextOffset: 2000, totalChars: record.response.length } : {}) } : {}),
      ...(record.error ? { error: record.error } : {}),
      ...(record.status === 'running' ? { message: '已接入，对方仍在执行；可用contact_read查询，请继续其他工作，不要重发同一请求。' } : {}) }),
    meta: { contactId: record.id, status: record.status, delivered: record.delivered } };
}

export async function readContactCommunicationOutcome(
  input: Pick<ContactCommunicationInput, 'dataDir' | 'workshopId' | 'fromSeatId' | 'sourceKind'>,
  args: Record<string, string>,
): Promise<ToolCallOutcome> {
  try {
    if (Object.keys(args).some(key => !['contactId', 'offset'].includes(key))
      || typeof args.contactId !== 'string' || !args.contactId
      || (args.offset !== undefined && !/^\d+$/.test(String(args.offset)))) throw new Error('请填写contactId和可选的非负offset');
    const offset = Number(args.offset ?? 0);
    if (!Number.isSafeInteger(offset)) throw new Error('offset无效');
    const record = await readContactCommunication(input.dataDir, input.workshopId, args.contactId);
    const kind = input.sourceKind ?? 'seat';
    if (!record || !((record.sourceId === input.fromSeatId && record.sourceKind === kind)
      || (record.targetId === input.fromSeatId && record.targetKind === kind))) throw new Error('本岗位找不到这条联络记录');
    if (persistenceFailures.has(recordKey(input.dataDir, record))) throw new Error('联络终态保存失败，暂时无法确认结果');
    const body = record.response ?? '';
    if (offset > body.length) throw new Error('offset超出回复范围');
    let end = Math.min(body.length, offset + 6000);
    const projection = () => ({ ...record, response: body.slice(offset, end), offset,
      totalChars: body.length, ...(end < body.length ? { nextOffset: end } : {}) });
    while (JSON.stringify(projection()).length > 18_000 && end > offset) end = offset + Math.floor((end - offset) / 2);
    return { ok: true, result: JSON.stringify(projection()) };
  } catch (error) { return { ok: false, result: `联络查询失败：${error instanceof Error ? error.message : '未知错误'}` }; }
}

export async function shutdownCycloneContacts(dataDir?: string): Promise<void> {
  for (const item of active.values()) if (!dataDir || path.resolve(item.dataDir) === path.resolve(dataDir)) item.controller.abort();
  const pending = [...tasks].filter(([, owner]) => !dataDir || path.resolve(owner) === path.resolve(dataDir));
  await Promise.allSettled(pending.map(([promise]) => promise));
}
export async function drainCycloneContacts(): Promise<void> {
  while (tasks.size) await Promise.allSettled([...tasks.keys()]);
}

function track<T>(dataDir: string, task: Promise<T>): Promise<T> {
  tasks.set(task, dataDir);
  void task.finally(() => tasks.delete(task)).catch(() => undefined);
  return task;
}
function recordKey(dataDir: string, record: Pick<ContactCommunication, 'workshopId' | 'id'>): string {
  return `${path.resolve(dataDir)}\0${record.workshopId}\0${record.id}`;
}
function pause(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise(resolve => {
    const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); };
    const timer = setTimeout(finish, ms);
    signal.addEventListener('abort', finish, { once: true });
  });
}
function waitForReply<T>(task: Promise<T>, ms: number, signal?: AbortSignal): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const finish = () => { clearTimeout(timer); signal?.removeEventListener('abort', timeout); };
    const timeout = () => { finish(); resolve(undefined); };
    const timer = setTimeout(timeout, ms);
    signal?.addEventListener('abort', timeout, { once: true });
    if (signal?.aborted) timeout();
    task.then(value => { finish(); resolve(value); }, error => { finish(); reject(frameworkError({
      code: 'CYCLONE_CONTACT_STORE_ERROR', kind: 'io', message: '联络结果未能保存，请查询记录核实，勿重复投递',
      source: 'cyclone.contact', retryable: false }, { cause: error })); });
  });
}
