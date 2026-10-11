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
