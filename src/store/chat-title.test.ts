import assert from 'node:assert/strict';
import test from 'node:test';
import { saveSession, getSession, deleteSession, nameCompletedSession, type ChatSession } from './chat.js';

function fixture(id: string): ChatSession {
  return { id: `agent-title-${id}`, agentId: 'agent-title', agentName: 'A', title: '新会话',
    titleState: 'pending', model: 'p:model', systemPrompt: '', createdAt: '2026-01-01', updatedAt: '2026-01-01',
    messages: [
      { id: 'u', role: 'user', content: '谈谈架构', agentId: 'agent-title', timestamp: '2026-01-01' },
      { id: 'a', role: 'assistant', content: '模块边界应明确', agentId: 'agent-title', timestamp: '2026-01-01' },
    ],
  };
}

test('模型命名持久化一次，后续消息删除及旧快照保存不改变标题', async t => {
  const env = mockStorage(t);
  const original = fixture('once');
  await saveSession(original);
  await Promise.all([nameCompletedSession(original.id), nameCompletedSession(original.id)]);
  assert.equal(env.calls(), 1);
  assert.equal((await getSession(original.id))?.title, '架构讨论');
  await saveSession({ ...original, messages: [] });
  await nameCompletedSession(original.id);
  assert.equal((await getSession(original.id))?.title, '架构讨论');
  assert.equal((await getSession(original.id))?.titleState, 'generated');
  assert.equal(env.calls(), 1);
});

test('命名期间手动改名优先，迟到结果不覆盖后续消息', async t => {
  const env = mockStorage(t, true);
  const original = fixture('manual');
  await saveSession(original);
  const naming = nameCompletedSession(original.id);
  await env.started;
  await saveSession({ ...original, title: '人类标题', titleManual: true, messages: [] }, { rename: true });
  env.finish();
  await naming;
  await saveSession(original);
  assert.equal((await getSession(original.id))?.title, '人类标题');
  assert.equal((await getSession(original.id))?.titleManual, true);
});

test('命名期间删除会话，迟到结果不重建文件', async t => {
  const env = mockStorage(t, true);
  const original = fixture('deleted');
  await saveSession(original);
  const naming = nameCompletedSession(original.id);
  await env.started;
  await deleteSession(original.id);
  env.finish();
  await naming;
  assert.equal(await getSession(original.id), null);
});

test('旧会话和手动标题不发命名请求', async t => {
  const env = mockStorage(t);
  await saveSession({ ...fixture('legacy'), titleState: undefined });
  await saveSession({ ...fixture('named'), titleManual: true });
  await nameCompletedSession('agent-title-legacy');
  await nameCompletedSession('agent-title-named');
  assert.equal(env.calls(), 0);
});

function mockStorage(t: Parameters<Parameters<typeof test>[1]>[0], deferred = false) {
  const files = new Map<string, string>();
  let count = 0;
  let finish!: () => void;
  let start!: () => void;
  const started = new Promise<void>(resolve => { start = resolve; });
  const gate = new Promise<void>(resolve => { finish = resolve; });
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input), 'http://test');
    if (url.pathname === '/api/conversation/title') {
      count++; start();
      if (deferred) await gate;
      return Response.json({ title: '架构讨论' });
    }
    const key = url.searchParams.get('path') || '';
    if (url.pathname.endsWith('/write')) { files.set(key, String(init?.body)); return new Response(''); }
    if (url.pathname.endsWith('/read')) return files.has(key) ? new Response(files.get(key)) : new Response('', { status: 404 });
    if (url.pathname.endsWith('/delete')) files.delete(key);
    return new Response('');
  };
  return { calls: () => count, started, finish: () => finish() };
}
