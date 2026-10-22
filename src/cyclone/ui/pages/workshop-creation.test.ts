import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareWorkshopCreation } from './workshop-creation';

const workshop = { id: 'workshop-a', title: '项目工作室' };

test('创建工作室与主管配置分别使用会议助理和主管字段', async t => {
  const calls: Array<{ url: string; method?: string; body: unknown }> = [];
  t.mock.method(globalThis, 'fetch', async (input: unknown, init?: RequestInit) => {
    calls.push({ url: String(input), method: init?.method, body: JSON.parse(String(init?.body)) });
    return Response.json(calls.length === 1 ? workshop : { configured: true });
  });
  assert.deepEqual(await prepareWorkshopCreation({
    title: workshop.title, chairAgentId: 'meeting-assistant',
    supervisorAgentId: 'project-supervisor', supervisorRolePrompt: '统筹项目',
  }), { workshop });
  assert.deepEqual(calls, [
    { url: '/api/collaboration/invoke', method: 'POST', body: {
      feature: 'cyclone', method: 'createWorkshop',
      input: { title: workshop.title, chairAgentId: 'meeting-assistant' },
    } },
    { url: '/api/cyclone/workshop/workshop-a/supervisor/config', method: 'PUT',
      body: { agentId: 'project-supervisor', rolePrompt: '统筹项目' } },
  ]);
});

test('主管可留待以后配置，不创建额外会话或调用模型', async t => {
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: unknown, init?: RequestInit) => {
    calls.push(String(input));
    assert.deepEqual(JSON.parse(String(init?.body)), {
      feature: 'cyclone', method: 'createWorkshop', input: { title: workshop.title },
    });
    return Response.json(workshop);
  });
  assert.deepEqual(await prepareWorkshopCreation({ title: workshop.title }), { workshop });
  assert.deepEqual(calls, ['/api/collaboration/invoke']);
});

test('配置失败保留已创建回执，重试只配置同一工作室且默认空职责', async t => {
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: unknown, init?: RequestInit) => {
    calls.push(String(input));
    if (calls.length === 1) return Response.json(workshop);
    assert.deepEqual(JSON.parse(String(init?.body)), { agentId: 'project-supervisor', rolePrompt: '' });
    return calls.length === 2
      ? Response.json({ error: '主管配置暂不可用' }, { status: 503 })
      : Response.json({ configured: true });
  });
  const draft = { title: workshop.title, supervisorAgentId: 'project-supervisor' };
  const first = await prepareWorkshopCreation(draft);
  assert.deepEqual(first, { workshop, supervisorError: '主管配置暂不可用' });
  const retry = await prepareWorkshopCreation(draft, first.workshop);
  assert.equal(retry.workshop, first.workshop);
  assert.equal(retry.supervisorError, undefined);
  assert.deepEqual(calls, ['/api/collaboration/invoke',
    '/api/cyclone/workshop/workshop-a/supervisor/config',
    '/api/cyclone/workshop/workshop-a/supervisor/config']);
});

test('已创建工作室可跳过主管配置直接进入，不重复提交创建', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('不应发起请求'); });
  const result = await prepareWorkshopCreation({ title: '不会重新命名', chairAgentId: 'other-assistant' }, workshop);
  assert.equal(result.workshop, workshop);
  assert.equal(result.supervisorError, undefined);
});

test('创建失败保持真实错误，不尝试配置不存在的工作室', async t => {
  const failure = new Error('连接中断');
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; throw failure; });
  await assert.rejects(prepareWorkshopCreation({
    title: workshop.title, supervisorAgentId: 'project-supervisor',
  }), error => error === failure);
  assert.equal(calls, 1);
});
