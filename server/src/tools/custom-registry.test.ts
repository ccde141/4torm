import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { listToolCatalog, listToolCatalogWithDiagnostics, replaceCustomTools } from './custom-registry.js';
import { FRAMEWORK_TOOLS } from './framework/catalog.js';

async function tempData(t: test.TestContext): Promise<string> {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-custom-tools-'));
  await fs.mkdir(path.join(dataDir, 'tools'), { recursive: true });
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  return dataDir;
}

test('框架工具固定只读，自定义工具单独持久化', async t => {
  const dataDir = await tempData(t);
  const custom = {
    name: 'demo_tool', description: 'demo', executorType: 'custom' as const,
    executorFile: 'demo_tool', parameters: { type: 'object' },
  };
  await replaceCustomTools(dataDir, [custom]);
  const catalog = await listToolCatalog(dataDir);

  assert.deepEqual(catalog.slice(0, FRAMEWORK_TOOLS.length).map(tool => tool.source),
    FRAMEWORK_TOOLS.map(() => 'framework'));
  assert.equal(catalog.find(tool => tool.name === 'read_file')?.readonly, true);
  assert.equal(catalog.find(tool => tool.name === 'demo_tool')?.readonly, false);
  assert.equal(catalog.find(tool => tool.name === 'demo_tool')?.executionMode, 'sync');
});

test('自定义工具只接受同步或可后台化两种执行模式', async t => {
  const dataDir = await tempData(t);
  const base = {
    name: 'background_tool', description: 'background', executorType: 'custom' as const,
    executorFile: 'background_tool', parameters: { type: 'object' },
  };
  const saved = await replaceCustomTools(dataDir, [{ ...base, executionMode: 'detachable' }]);
  assert.equal(saved[0].executionMode, 'detachable');
  await assert.rejects(() => replaceCustomTools(dataDir, [{ ...base, executionMode: 'automatic' }]), /执行模式无效/);
});

test('用户数据不能覆盖框架工具', async t => {
  const dataDir = await tempData(t);
  await assert.rejects(() => replaceCustomTools(dataDir, [{
    name: 'read_file', description: 'shadow', executorType: 'custom',
    executorFile: 'shadow', parameters: { type: 'object' },
  }]), /框架工具不可覆盖/);
});

test('自定义工具不能占用框架能力运行时命名空间', async t => {
  const dataDir = await tempData(t);
  await assert.rejects(() => replaceCustomTools(dataDir, [{
    name: 'framework_capability_tradewind', description: 'shadow', executorType: 'custom',
    executorFile: 'shadow', parameters: { type: 'object' },
  }]), /框架工具不可覆盖/);
});

test('旧注册表冲突保留原文件，健康目录仍可读取并给出诊断', async t => {
  const dataDir = await tempData(t);
  const file = path.join(dataDir, 'tools', 'registry.json');
  const raw = JSON.stringify([{
    name: 'framework_capability_tide', description: 'legacy shadow', executorType: 'custom',
    executorFile: 'shadow', parameters: { type: 'object' },
  }, {
    name: 'healthy_tool', description: 'healthy', executorType: 'custom',
    executorFile: 'healthy', parameters: { type: 'object' },
  }]);
  await fs.writeFile(file, raw);

  const catalog = await listToolCatalogWithDiagnostics(dataDir);
  assert.equal(catalog.tools.some(tool => tool.name === 'healthy_tool'), true);
  assert.equal(catalog.tools.some(tool => tool.name === 'framework_capability_tide'), false);
  assert.match(catalog.conflicts.find(issue => issue.name === 'framework_capability_tide')?.reason ?? '', /框架保留名称/);
  assert.equal(await fs.readFile(file, 'utf8'), raw);
});

test('自定义工具不能把内部能力元数据带入目录', async t => {
  const dataDir = await tempData(t);
  const [saved] = await replaceCustomTools(dataDir, [{
    name: 'spoofed_tool', description: 'spoofed', executorType: 'custom',
    executorFile: 'spoofed', parameters: { type: 'object' },
    frameworkCapability: {
      id: 'tradewind', title: '伪造信风', route: '伪造路由', guidance: '伪造指导',
    },
  }]);
  const catalog = await listToolCatalog(dataDir);

  assert.equal(saved.frameworkCapability, undefined);
  assert.equal(catalog.find(tool => tool.name === 'spoofed_tool')?.frameworkCapability, undefined);
  await fs.writeFile(path.join(dataDir, 'tools', 'registry.json'), JSON.stringify([{
    name: 'legacy_spoofed', description: 'legacy', executorType: 'custom',
    executorFile: 'legacy', parameters: { type: 'object' },
    frameworkCapability: { id: 'tide', title: 'spoofed', route: 'spoofed', guidance: 'spoofed' },
  }]));
  assert.equal((await listToolCatalog(dataDir)).find(tool => tool.name === 'legacy_spoofed')?.frameworkCapability, undefined);
});

test('中心协作工具作为只读框架能力加入目录且保留名称所有权', async t => {
  const dataDir = await tempData(t);
  const collaboration = [{
    name: 'create_collaboration', description: '创建协作组',
    category: 'system', executorType: 'builtin', parameters: { type: 'object' },
  }];
  const catalog = await listToolCatalog(dataDir, collaboration);
  const tool = catalog.find(item => item.name === 'create_collaboration');
  assert.equal(tool?.source, 'framework');
  assert.equal(tool?.readonly, true);
  await assert.rejects(() => replaceCustomTools(dataDir, [{
    name: 'create_collaboration', description: 'shadow', executorType: 'custom',
    executorFile: 'shadow', parameters: { type: 'object' },
  }], ['create_collaboration']), /框架工具不可覆盖/);
});

test('目录拒绝框架自身重名，并隔离旧自定义冲突项', async t => {
  const dataDir = await tempData(t);
  await assert.rejects(() => listToolCatalog(dataDir, [{
    name: 'read_file', description: 'duplicate', parameters: { type: 'object' },
  }]), /框架工具重复/);
  await replaceCustomTools(dataDir, [{
    name: 'create_collaboration', description: 'old custom', executorType: 'custom',
    executorFile: 'old', parameters: { type: 'object' },
  }]);
  const catalog = await listToolCatalogWithDiagnostics(dataDir, [{
    name: 'create_collaboration', description: 'framework', parameters: { type: 'object' },
  }]);
  assert.equal(catalog.tools.filter(tool => tool.name === 'create_collaboration').length, 1);
  assert.equal(catalog.tools.find(tool => tool.name === 'create_collaboration')?.source, 'framework');
  assert.match(catalog.conflicts.find(issue => issue.name === 'create_collaboration')?.reason ?? '', /框架保留名称/);
});

test('自定义替换拒绝虚拟工具和已安装技能名称', async t => {
  const dataDir = await tempData(t);
  const make = (name: string) => ({ name, description: 'test', executorType: 'custom',
    executorFile: name, parameters: { type: 'object' } });
  await assert.rejects(() => replaceCustomTools(dataDir, [make('register_tool')]), /框架工具不可覆盖/);
  await fs.mkdir(path.join(dataDir, 'skills', 'demo'), { recursive: true });
  await fs.writeFile(path.join(dataDir, 'skills', 'demo', 'tools.json'), JSON.stringify([make('skill_tool')]));
  await assert.rejects(() => replaceCustomTools(dataDir, [make('skill_tool')]), /技能「demo」/);
});

test('内部收口、记忆与执行能力名称不可注册，旧冲突可诊断', async t => {
  const dataDir = await tempData(t);
  const make = (name: string) => ({ name, description: 'shadow', executorType: 'custom',
    executorFile: name, parameters: { type: 'object' } });
  const reserved = [
    'done', 'memory_write', 'memory_list', 'memory_read', 'browser',
    'seat_memory_read', 'seat_memory_write',
    'seat_activity_read', 'seat_dispatch_read',
    'inspect_execution', 'wait_execution', 'terminate_execution',
    'team_start', 'team_create', 'team_dispatch', 'team_read', 'team_wait',
    'team_ack', 'team_review', 'team_dismiss',
    'envelope_add', 'envelope_remove', 'envelope_list',
    'find_operation_records', 'read_operation_record',
  ];
  for (const name of reserved) {
    await assert.rejects(() => replaceCustomTools(dataDir, [make(name)]), /框架工具不可覆盖/);
  }
  const file = path.join(dataDir, 'tools', 'registry.json');
  const raw = JSON.stringify(reserved.map(make));
  await fs.writeFile(file, raw);
  const catalog = await listToolCatalogWithDiagnostics(dataDir);
  for (const name of reserved) {
    assert.equal(catalog.tools.some(tool => tool.name === name && tool.source === 'custom'), false);
    assert.match(catalog.conflicts.find(issue => issue.name === name)?.reason ?? '', /框架保留名称/);
  }
  assert.equal(await fs.readFile(file, 'utf8'), raw);
});

test('损坏的旧注册表给出诊断且不会被替换请求覆盖', async t => {
  const dataDir = await tempData(t);
  const file = path.join(dataDir, 'tools', 'registry.json');
  await fs.writeFile(file, '{broken');
  const catalog = await listToolCatalogWithDiagnostics(dataDir);
  assert.equal(catalog.tools.some(tool => tool.name === 'read_file'), true);
  assert.match(catalog.conflicts[0]?.reason ?? '', /JSON 损坏/);
  await assert.rejects(() => replaceCustomTools(dataDir, [{
    name: 'new_tool', description: 'new', executorType: 'custom',
    executorFile: 'new_tool', parameters: { type: 'object' },
  }]), /JSON 损坏/);
  assert.equal(await fs.readFile(file, 'utf8'), '{broken');
});
