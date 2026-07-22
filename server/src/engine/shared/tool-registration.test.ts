import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  commitToolRegistration,
  isToolRegistrationApproved,
  prepareToolRegistration,
  resolveToolRegistration,
} from './tool-registration.js';

async function createDataDir(): Promise<string> {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-tool-registration-'));
  await fs.mkdir(path.join(dataDir, 'tools', 'executors'), { recursive: true });
  await fs.writeFile(path.join(dataDir, 'tools', 'registry.json'), '[]');
  return dataDir;
}

async function writeExecutor(dataDir: string, name: string): Promise<void> {
  await fs.writeFile(
    path.join(dataDir, 'tools', 'executors', `${name}.js`),
    'export default async function () { return "ok"; }\n',
  );
}

function args(name: string): Record<string, string> {
  return {
    name,
    description: `${name} description`,
    dangerous: 'false',
    executorFile: name,
    parameters: JSON.stringify({
      type: 'object',
      properties: { input: { type: 'string', description: 'input' } },
      required: ['input'],
    }),
  };
}

test('tool registration validates the executor and refuses existing names before confirmation', async (t) => {
  const dataDir = await createDataDir();
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));

  await assert.rejects(() => prepareToolRegistration(dataDir, args('missing')), /执行器不存在/);

  await writeExecutor(dataDir, 'existing');
  await fs.writeFile(path.join(dataDir, 'tools', 'registry.json'), JSON.stringify([
    { name: 'existing', description: 'old', category: 'custom', dangerous: false, executorType: 'custom', executorFile: 'existing', parameters: { type: 'object', properties: {} } },
  ]));
  await assert.rejects(() => prepareToolRegistration(dataDir, args('existing')), /已经注册/);
});

test('tool registration refuses names already provided by a skill', async (t) => {
  const dataDir = await createDataDir();
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  await writeExecutor(dataDir, 'skill_tool');
  await fs.mkdir(path.join(dataDir, 'skills', 'demo'), { recursive: true });
  await fs.writeFile(path.join(dataDir, 'skills', 'demo', 'tools.json'), JSON.stringify([
    { name: 'skill_tool', description: 'from skill' },
  ]));
  await assert.rejects(() => prepareToolRegistration(dataDir, args('skill_tool')), /技能「demo」/);
});

test('concurrent confirmed registrations keep both tools without overwriting the registry', async (t) => {
  const dataDir = await createDataDir();
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  await Promise.all([writeExecutor(dataDir, 'alpha_tool'), writeExecutor(dataDir, 'beta_tool')]);

  const alpha = await prepareToolRegistration(dataDir, args('alpha_tool'));
  const beta = await prepareToolRegistration(dataDir, args('beta_tool'));
  await Promise.all([
    commitToolRegistration(dataDir, alpha),
    commitToolRegistration(dataDir, beta),
  ]);

  const registry = JSON.parse(await fs.readFile(path.join(dataDir, 'tools', 'registry.json'), 'utf8')) as Array<{ name: string }>;
  assert.deepEqual(registry.map(tool => tool.name), ['alpha_tool', 'beta_tool']);
  assert.match(await commitToolRegistration(dataDir, alpha), /已经注册/);
});

test('registration approval accepts explicit confirmation only', () => {
  assert.equal(isToolRegistrationApproved('注册'), true);
  assert.equal(isToolRegistrationApproved('确认'), true);
  assert.equal(isToolRegistrationApproved('取消'), false);
  assert.equal(isToolRegistrationApproved('以后再说'), false);
});

test('registration resolution leaves cancellation untouched and commits the original proposal', async (t) => {
  const dataDir = await createDataDir();
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  await writeExecutor(dataDir, 'approved_tool');
  const proposal = await prepareToolRegistration(dataDir, args('approved_tool'));

  const cancelled = await resolveToolRegistration(dataDir, proposal, '取消');
  assert.equal(cancelled.ok, true);
  assert.match(cancelled.result, /已取消/);
  assert.equal(JSON.parse(await fs.readFile(path.join(dataDir, 'tools', 'registry.json'), 'utf8')).length, 0);

  const approved = await resolveToolRegistration(dataDir, proposal, '注册');
  assert.equal(approved.ok, true);
  assert.match(approved.result, /已注册/);
  const registry = JSON.parse(await fs.readFile(path.join(dataDir, 'tools', 'registry.json'), 'utf8')) as Array<{ name: string }>;
  assert.deepEqual(registry.map(tool => tool.name), ['approved_tool']);
});
