import assert from 'node:assert/strict';
import test from 'node:test';
import { buildContactToolCatalog, buildSeatToolCatalog } from './seat-tool-catalog.js';
import { buildSeatContactSystemPrompt, buildSeatSystemPrompt } from './seat-prompt.js';

test('工位文本协议列出运行时真实可调用的派发与后台工具', () => {
  const catalog = buildSeatToolCatalog(
    [{ name: 'read_file', description: '读取文件' }],
    [{ title: '后端', duty: '实现接口' }],
    [{ title: '后端', duty: '实现接口' }],
  );
  const names = catalog.map(tool => tool.name);
  assert.equal(new Set(names).size, names.length);
  for (const name of ['read_file', 'dispatch', 'contact', 'task_board', 'delegate']) {
    assert.ok(names.includes(name), `缺少 ${name}`);
  }

  const prompt = buildSeatSystemPrompt({
    dataDir: 'C:/tmp/4torm-data', workshopId: 'workshop-a',
    seat: { id: 'seat-a', title: '架构', rolePrompt: '', agentId: 'agent-a', messages: [], createdAt: '', updatedAt: '' },
    agent: { id: 'agent-a', name: 'Agent A', model: 'provider:model', rolePrompt: '', temperature: 0.7,
      tools: [], toolMode: 'selected', skills: [], workspace: '', sandboxLevel: 'relaxed' },
    toolDefs: catalog, native: false,
    wsRelPath: 'data/cyclone/workshop-a/workspace',
  });
  for (const name of names) assert.match(prompt, new RegExp(`### ${name}\\b`));
  assert.match(prompt, /收尾前再用 seat_dispatch_read 核对一次有关派发/);
  assert.match(prompt, /给人类的回复末尾/);
  assert.match(prompt, /避免连续轮询或空等/);
  assert.match(prompt, /不必每轮通读履历和记忆/);
  const activity = catalog.find(tool => tool.name === 'seat_activity_read');
  assert.deepEqual(activity?.parameters?.properties?.filter?.enum, ['all', 'work', 'changes']);
  assert.equal(activity?.parameters?.properties?.limit?.maximum, 12);
  assert.equal(activity?.parameters?.properties?.cursor?.type, 'string');
});

test('没有派发目标时不向工位建议不存在的派发工具', () => {
  const catalog = buildSeatToolCatalog([], [], []);
  assert.equal(catalog.some(tool => tool.name === 'dispatch'), false);
  const delegate = catalog.find(tool => tool.name === 'delegate');
  assert.doesNotMatch(delegate?.description || '', /优先 dispatch/);
});

test('被联络工位的文本协议列出实际可用的协作工具', () => {
  const catalog = buildContactToolCatalog([], [{ title: '后端', duty: '实现接口' }]);
  const prompt = buildSeatContactSystemPrompt({
    dataDir: 'C:/tmp/4torm-data', workshopId: 'workshop-a',
    seat: { id: 'seat-a', title: '架构', rolePrompt: '', agentId: 'agent-a', messages: [], createdAt: '', updatedAt: '' },
    agent: { id: 'agent-a', name: 'Agent A', model: 'provider:model', rolePrompt: '', temperature: 0.7,
      tools: [], toolMode: 'selected', skills: [], workspace: '', sandboxLevel: 'relaxed' },
    toolDefs: catalog, native: false, fromTitle: '后端',
    wsRelPath: 'data/cyclone/workshop-a/workspace',
  });
  for (const name of ['bulletin', 'delegate', 'contact']) {
    assert.match(prompt, new RegExp(`### ${name}\\b`));
  }
  assert.doesNotMatch(prompt, /### ask\b|### task_board\b/);
});

test('局部策略移除对应协作工具但保留池中其他能力和场景工具', () => {
  const policy = { contact: false, dispatch: false, bulletin: false };
  const real = [{ name: 'read_file', description: '文件' }, { name: 'framework', description: '框架' }];
  const targets = [{ title: '同事', duty: '协作' }];
  for (const catalog of [buildSeatToolCatalog(real, targets, targets, policy),
    buildContactToolCatalog(real, targets, policy)]) {
    const names = catalog.map(tool => tool.name);
    for (const name of ['contact', 'dispatch', 'bulletin']) assert.equal(names.includes(name), false);
    for (const name of ['read_file', 'framework', 'delegate']) assert.equal(names.includes(name), true);
  }
});
