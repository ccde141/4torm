import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { executeTool, getToolExecutionMode } from './tool-executor.js';

test('executeTool passes the caller AbortSignal to custom executors', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-tool-abort-'));
  const dataDir = path.join(root, 'data');
  const executorDir = path.join(dataDir, 'tools', 'executors');
  await fs.mkdir(executorDir, { recursive: true });
  await fs.writeFile(path.join(dataDir, 'tools', 'registry.json'), JSON.stringify([{
    name: 'wait_for_abort',
    description: 'test',
    executorType: 'custom',
    executorFile: 'wait_for_abort',
  }]));
  await fs.writeFile(path.join(executorDir, 'wait_for_abort.js'), `
    export default (_args, ctx) => new Promise((resolve) => {
      if (ctx.signal?.aborted) return resolve('aborted');
      ctx.signal?.addEventListener('abort', () => resolve('aborted'), { once: true });
      setTimeout(() => resolve('missing signal'), 100);
    });
  `);

  try {
    const controller = new AbortController();
    const pending = executeTool(
      dataDir, 'wait_for_abort', {}, '', undefined, undefined, undefined,
      controller.signal,
    );
    controller.abort();
    assert.equal(await pending, 'aborted');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('executeTool passes optional output observation to custom executors', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-tool-output-'));
  const dataDir = path.join(root, 'data');
  const executorDir = path.join(dataDir, 'tools', 'executors');
  await fs.mkdir(executorDir, { recursive: true });
  await fs.writeFile(path.join(dataDir, 'tools', 'registry.json'), JSON.stringify([{
    name: 'emit_output', description: 'test', executorType: 'custom', executorFile: 'emit_output',
  }]));
  await fs.writeFile(path.join(executorDir, 'emit_output.js'), `
    export default (_args, ctx) => { ctx.onOutput('stdout', 'live'); return { result: 'done' }; }
  `);

  try {
    const output: Array<[string, string]> = [];
    const result = await executeTool(
      dataDir, 'emit_output', {}, '', undefined, undefined, undefined, undefined,
      (stream, text) => output.push([stream, text]),
    );
    assert.equal(result, 'done');
    assert.deepEqual(output, [['stdout', 'live']]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('template executors preserve output observation when detachable', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-tool-template-output-'));
  const dataDir = path.join(root, 'data');
  const executorDir = path.join(dataDir, 'tools', 'executors');
  await fs.mkdir(executorDir, { recursive: true });
  await fs.writeFile(path.join(dataDir, 'tools', 'registry.json'), JSON.stringify([{
    name: 'template_output', description: 'test', executorType: 'template',
    executorTemplate: 'echo {{text}}', executionMode: 'detachable',
  }]));
  await fs.writeFile(path.join(executorDir, 'run_command.js'), `
    export function runCommand(_command, ctx) { ctx.onOutput('stdout', 'template live'); return Promise.resolve('done'); }
  `);

  try {
    const output: Array<[string, string]> = [];
    const result = await executeTool(
      dataDir, 'template_output', { text: 'hello' }, '', undefined, undefined, undefined, undefined,
      (stream, text) => output.push([stream, text]),
    );
    assert.equal(result, 'done');
    assert.deepEqual(output, [['stdout', 'template live']]);
    assert.equal(await getToolExecutionMode(dataDir, 'template_output'), 'detachable');
    assert.equal(await getToolExecutionMode(dataDir, 'unknown'), 'sync');
    assert.equal(await getToolExecutionMode(dataDir, 'mcp:demo:tool'), 'sync');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
