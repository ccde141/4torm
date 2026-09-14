export interface InputSubmission {
  agentId: string;
  sessionId: string;
  runId: string;
  id: string;
  content: string;
}

export type InputDeliveryState = 'sending' | 'received' | 'queued' | 'included' | 'continued' | 'retained';
interface Ports {
  request: typeof fetch;
  settled: () => Promise<boolean>;
  nextTurn: (input: InputSubmission) => Promise<void>;
  notify: (state: InputDeliveryState) => void;
}
interface Journal {
  entries: unknown[];
  active: boolean;
  checkpoint?: { closed: boolean; includedIds: string[] };
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid input response');
  return value as Record<string, unknown>;
}

function matchesReceipt(value: unknown, input: InputSubmission): boolean {
  const entry = object(value);
  if (entry.id !== input.id) return false;
  if (entry.content !== input.content || entry.runId !== input.runId
    || !Number.isSafeInteger(entry.sequence) || Number(entry.sequence) < 1
    || typeof entry.receivedAt !== 'string') throw new Error('Input receipt identity conflict');
  return true;
}

async function readJournal(input: InputSubmission, request: typeof fetch): Promise<Journal> {
  const query = new URLSearchParams({ agentId: input.agentId, sessionId: input.sessionId, runId: input.runId });
  const response = await request(`/api/conversation/input?${query}`);
  if (!response.ok) throw new Error(`Input receipt check HTTP ${response.status}`);
  const value = object(await response.json());
  if (!Array.isArray(value.entries) || typeof value.active !== 'boolean') throw new Error('Invalid input journal');
  if (value.checkpoint !== undefined) {
    const checkpoint = object(value.checkpoint);
    if (typeof checkpoint.closed !== 'boolean' || !Array.isArray(checkpoint.includedIds)
      || !checkpoint.includedIds.every(id => typeof id === 'string')) throw new Error('Invalid input checkpoint');
  }
  return value as unknown as Journal;
}

/** A GET resolves an uncertain POST; it never authorizes replay while acceptance is still possible. */
async function reconcile(input: InputSubmission, request: typeof fetch): Promise<'received' | 'queued'> {
  const journal = await readJournal(input, request);
  if (journal.entries.some(entry => matchesReceipt(entry, input))) return 'received';
  if (!journal.active && journal.checkpoint?.closed) return 'queued';
  throw new Error('尚无法确认接收状态，消息已保留 / Cannot confirm receipt; message retained');
}

async function submit(input: InputSubmission, request: typeof fetch): Promise<'received' | 'queued'> {
  let response: Response;
  try {
    response = await request('/api/conversation/input', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
  } catch { return reconcile(input, request); }
  // Server errors may follow a durable write. Only read back, never repeat the POST.
  if (response.status >= 500) return reconcile(input, request);
  if (!response.ok) throw new Error(await response.text());
  let value: Record<string, unknown>;
  try { value = object(await response.json()); }
  catch { return reconcile(input, request); }
  if (value.disposition === 'next-turn') return 'queued';
  if (matchesReceipt(value.receipt, input)) return 'received';
  throw new Error('Invalid input acknowledgement');
}

/** One user action owns one ID through receipt reconciliation and the next-turn handoff. */
export async function deliverHumanInput(input: InputSubmission, ports: Ports, checkOnly = false): Promise<InputDeliveryState> {
  ports.notify('sending');
  const state = checkOnly ? await reconcile(input, ports.request) : await submit(input, ports.request);
  ports.notify(state);
  if (!await ports.settled()) return 'retained';
  if (state === 'received') {
    const journal = await readJournal(input, ports.request);
    if (!journal.entries.some(entry => matchesReceipt(entry, input))) throw new Error('Input receipt disappeared');
    if (journal.checkpoint?.includedIds.includes(input.id)) return 'included';
    if (journal.active || !journal.checkpoint?.closed) throw new Error('Input run has not closed');
  }
  ports.notify('queued');
  await ports.nextTurn(input);
  return 'continued';
}
