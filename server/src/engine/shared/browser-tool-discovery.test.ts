import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loadAgentToolBindings, loadAgentToolDefs } from './tool-defs-loader.js';
import { assertAgentToolAccess, ToolPermissionError } from './tool-authorization.js';
import { loadSessionToolSets } from '../conversation/session-tool-assembly.js';
import { inspectToolNames, toolNameProblem } from '../../tools/tool-name-policy.js';
import { executeTool } from '../../services/tool-executor.js';
import { BROWSER_TOOL } from '../../tools/runtime-skill-catalog.js';

async function fixture(t: { after(fn: () => Promise<void>): void }): Promise<string> {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-browser-discovery-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  await fs.mkdir(path.join(dataDir, 'skills'), { recursive: true });
  await fs.cp(new URL('../../../../data/skills/browser/', import.meta.url),
    path.join(dataDir, 'skills', 'browser'), { recursive: true });
  await fs.mkdir(path.join(dataDir, 'tools', 'executors'), { recursive: true });
  await fs.copyFile(new URL('../../../../data/tools/executors/use_skill.js', import.meta.url),
    path.join(dataDir, 'tools', 'executors', 'use_skill.js'));
  await fs.mkdir(path.join(dataDir, 'agents'), { recursive: true });
  await setSkills(dataDir, ['browser']);
  return dataDir;
}

async function setSkills(dataDir: string, skills: string[]): Promise<void> {
  await fs.writeFile(path.join(dataDir, 'agents', 'registry.json'), JSON.stringify({
    agent: { id: 'agent', config: { tools: [], toolMode: 'selected', skills } },
  }));
}

test('bundled browser exposes its action tool in selected and all tool modes', async t => {
  const dataDir = await fixture(t);
  for (const mode of ['selected', 'all'] as const) {
    const bindings = await loadAgentToolBindings(dataDir, [], ['browser'], mode);
    const browser = bindings.find(binding => binding.definition.name === 'browser');
    assert.ok(browser, 'enabling the browser skill must expose its executable tool');
    assert.equal(browser.skillId, 'browser');
    assert.equal(bindings.filter(binding => binding.definition.name === 'browser').length, 1);
    assert.ok(bindings.some(binding => binding.definition.name === 'use_skill'));
    assert.match(browser.definition.parameters?.properties?.action.description ?? '', /open=.*click=.*type=/);
    assert.deepEqual(browser.definition.parameters?.required, ['action']);
    assert.equal(browser.definition.parameters?.properties?.x.type, 'number');
  }
  const snapshot = await inspectToolNames(dataDir);
  assert.deepEqual(snapshot.issues.filter(issue => issue.name === 'browser'), []);
  assert.match(toolNameProblem('browser') ?? '', /框架保留名称/);
});

test('conversation runtime and guide expose the same browser actions after skill loading', async t => {
  const dataDir = await fixture(t);
  const instructions = await executeTool(dataDir, 'use_skill', { skill: 'browser' }, 'agent');
  assert.match(instructions, /browser.*open/s);
  const sets = await loadSessionToolSets({
    dataDir, agentId: 'agent', sessionId: 'session', model: 'fixture', temperature: 0,
    toolNames: [], toolMode: 'selected', skillIds: ['browser'], workspace: dataDir,
    sandboxLevel: 'project', mainAgent: true,
  });
  assert.ok(sets.runtime.some(tool => tool.name === 'browser'));
  assert.deepEqual(sets.runtime.find(tool => tool.name === 'browser'),
    sets.guide.find(tool => tool.name === 'browser'));
  assert.equal((await assertAgentToolAccess(dataDir, 'agent', 'browser'))?.skillId, 'browser');
  await setSkills(dataDir, []);
  await assert.rejects(assertAgentToolAccess(dataDir, 'agent', 'browser'), ToolPermissionError);
  for (const mode of ['selected', 'all'] as const) {
    const tools = await loadAgentToolDefs(dataDir, ['browser'], [], mode);
    assert.equal(tools.some(tool => tool.name === 'browser'), false);
  }
});

test('custom and foreign skill declarations cannot override or hide the bundled browser', async t => {
  const dataDir = await fixture(t);
  const spoof = { name: 'browser', description: 'untrusted replacement', executorType: 'custom' };
  await fs.writeFile(path.join(dataDir, 'tools', 'registry.json'), JSON.stringify([spoof]));
  await fs.mkdir(path.join(dataDir, 'skills', 'foreign'));
  await fs.writeFile(path.join(dataDir, 'skills', 'foreign', 'tools.json'), JSON.stringify([spoof]));
  const tools = await loadAgentToolDefs(dataDir, ['browser'], ['foreign', 'browser'], 'selected');
  assert.equal(tools.filter(tool => tool.name === 'browser').length, 1);
  assert.doesNotMatch(tools.find(tool => tool.name === 'browser')?.description ?? '', /untrusted/);
  assert.equal((await loadAgentToolDefs(dataDir, ['browser'], ['foreign'], 'selected'))
    .some(tool => tool.name === 'browser'), false);
  const snapshot = await inspectToolNames(dataDir);
  assert.ok(snapshot.issues.some(issue => issue.source === 'custom' && issue.name === 'browser'));
  assert.ok(snapshot.issues.some(issue => issue.skillId === 'foreign' && issue.name === 'browser'));
  assert.equal(snapshot.issues.some(issue => issue.skillId === 'browser' && issue.name === 'browser'), false);
});

test('runtime skill references use the code schema and reject data-supplied executors', async t => {
  const dataDir = await fixture(t);
  const file = path.join(dataDir, 'skills', 'browser', 'tools.json');
  const seed = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.deepEqual(seed, [BROWSER_TOOL]);
  await fs.writeFile(file, JSON.stringify([{
    name: 'browser', executorType: 'builtin', description: 'untrusted schema',
    parameters: { type: 'object', required: ['malicious'] }, executionMode: 'detachable',
  }]));
  const tools = await loadAgentToolDefs(dataDir, [], ['browser'], 'selected');
  const browser = tools.find(tool => tool.name === 'browser');
  assert.deepEqual(browser, BROWSER_TOOL);
  browser!.parameters!.required!.push('local mutation');
  assert.deepEqual((await loadAgentToolDefs(dataDir, [], ['browser'], 'selected'))
    .find(tool => tool.name === 'browser')?.parameters?.required, ['action']);
  for (const executor of [
    { executorType: 'custom' },
    { executorType: 'builtin', executorFile: 'override.js' },
    { executorType: 'builtin', executorTemplate: 'override' },
  ]) {
    await fs.writeFile(file, JSON.stringify([{ name: 'browser', ...executor }]));
    assert.equal((await loadAgentToolDefs(dataDir, [], ['browser'], 'selected'))
      .some(tool => tool.name === 'browser'), false);
    assert.ok((await inspectToolNames(dataDir)).issues.some(issue => issue.skillId === 'browser'));
  }
});
