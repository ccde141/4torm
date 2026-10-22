import { backendFetch } from '../lib/backend-client';
export interface NamingInput { model: string; user: string; assistant: string }
export class TitleCompletion {
  private answered = false;
  private completed = false;
  private failed = false;
  observe(type: string): void {
    if (type === 'answer') this.answered = true;
    if (type === 'done') this.completed = true;
    if (type === 'error' || type === 'ask') this.failed = true;
  }
  ready(aborted: boolean): boolean {
    return this.answered && this.completed && !this.failed && !aborted;
  }
}
interface NamingPorts {
  claim(id: string): Promise<NamingInput | null>;
  generate(input: NamingInput): Promise<string>;
  apply(id: string, title: string): Promise<void>;
}

export async function nameSessionOnce(id: string, ports: NamingPorts): Promise<void> {
  const input = await ports.claim(id);
  if (!input) return;
  const title = await ports.generate(input);
  await ports.apply(id, title);
}

export async function requestSessionTitle(input: NamingInput): Promise<string> {
  const response = await backendFetch('/api/conversation/title', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input), signal: AbortSignal.timeout(65000),
  });
  if (!response.ok) throw new Error(`会话命名失败: ${await response.text()}`);
  const result: unknown = await response.json();
  if (!result || typeof result !== 'object' || !('title' in result)
    || typeof result.title !== 'string' || !result.title.trim()) throw new Error('会话标题响应无效');
  return result.title;
}

// 同一 Agent 的索引和会话写操作串行；失败传给调用方，后续操作不重试前项。
const writes = new Map<string, Promise<unknown>>();
export async function withSessionWrite<T>(agentId: string, work: () => Promise<T>): Promise<T> {
  const previous = writes.get(agentId);
  const pending = (previous ? previous.then(work, work) : Promise.resolve().then(work));
  writes.set(agentId, pending);
  try { return await pending; }
  finally { if (writes.get(agentId) === pending) writes.delete(agentId); }
}
