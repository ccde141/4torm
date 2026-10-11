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

test('模型命名持久化一次，旧快照不能删除消息或覆盖标题', async t => {
  const env = mockStorage(t);
  const original = fixture('once');
  const created = await saveSession(original);
  await Promise.all([nameCompletedSession(original.id), nameCompletedSession(original.id)]);
  assert.equal(env.calls(), 1);
  assert.equal((await getSession(original.id))?.title, '架构讨论');
  await assert.rejects(saveSession({ ...created, messages: [] }), /会话已被其他操作更新/);
  await nameCompletedSession(original.id);
  assert.equal((await getSession(original.id))?.title, '架构讨论');
  assert.equal((await getSession(original.id))?.titleState, 'generated');
  assert.equal(env.calls(), 1);
});

test('命名期间手动改名优先，迟到结果不覆盖后续消息', async t => {
  const env = mockStorage(t, true);
  const original = fixture('manual');
  const created = await saveSession(original);
  const naming = nameCompletedSession(original.id);
  await env.started;
  const latest = await getSession(original.id);
  assert.ok(latest);
  await saveSession({ ...latest, title: '人类标题', titleManual: true }, { rename: true });
  env.finish();
  await naming;
  await assert.rejects(saveSession(created), /会话已被其他操作更新/);
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
  const sessions = new Map<string, ChatSession>();
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
    if (url.pathname === '/api/conversation/sessions' && init?.method === 'POST') {
      const value = { ...JSON.parse(String(init.body)), revision: 1 } as ChatSession;
      if (sessions.has(value.id)) return Response.json({ error: '会话已经存在' }, { status: 409 });
      sessions.set(value.id, value);
      return Response.json(value, { status: 201 });
    }
    const match = url.pathname.match(/^\/api\/conversation\/sessions\/([^/]+)\/([^/]+)$/);
    if (match) {
      const id = decodeURIComponent(match[2]!);
      const current = sessions.get(id);
      if (init?.method === 'DELETE') { sessions.delete(id); return Response.json({ ok: true }); }
      if (init?.method === 'PUT') {
        if (!current) return Response.json({ error: '会话不存在' }, { status: 404 });
        const body = JSON.parse(String(init.body));
        if (body.expectedRevision !== current.revision) {
          return Response.json({ error: '会话已被其他操作更新', current }, { status: 409 });
        }
        const incoming = body.session as ChatSession;
        const next = body.mode === 'rename'
          ? { ...current, title: incoming.title, titleManual: incoming.titleManual,
            titleState: incoming.titleState, revision: current.revision! + 1 }
          : { ...incoming, title: current.title, titleManual: current.titleManual,
            titleState: current.titleState, revision: current.revision! + 1 };
        sessions.set(id, next);
        return Response.json(next);
      }
      return current ? Response.json(current) : new Response('', { status: 404 });
    }
    return new Response('', { status: 404 });
  };
  return { calls: () => count, started, finish: () => finish() };
}
