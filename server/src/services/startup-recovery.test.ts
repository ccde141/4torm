import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { agentRegistryFile, tradewindRunDir } from './data-paths.js';
import { recoverStartupState } from './startup-recovery.js';

test('启动恢复释放 Agent 残留锁并标记 Tradewind 运行记录为 crashed', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-startup-recovery-'));
  const dataDir = path.join(root, 'data');
  const registryFile = agentRegistryFile(dataDir);
  const runDir = tradewindRunDir(dataDir, 'wf-1', 'run-1');
  await fs.mkdir(path.dirname(registryFile), { recursive: true });
  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(registryFile, JSON.stringify({
    agentA: { busy: true, status: 'tradewind' },
    agentB: { busy: false, status: 'offline' },
  }));
  await fs.writeFile(path.join(runDir, 'meta.json'), JSON.stringify({
    executionId: 'run-1',
    workflowId: 'wf-1',
    startTime: '2026-01-01T00:00:00.000Z',
    status: 'running',
  }));
  const sessionsDir = path.join(dataDir, 'agents', 'agentA', 'sessions');
  const workspaceDir = path.join(dataDir, 'agents', 'agentA', '.workspace');
  await fs.mkdir(sessionsDir, { recursive: true });
  await fs.mkdir(workspaceDir, { recursive: true });
  const atomicTemp = path.join(sessionsDir, 'session.json.4321.123e4567-e89b-42d3-a456-426614174000.tmp');
  const storageTemp = path.join(sessionsDir, 'session.json.4321.1760000000000.abc123.tmp');
  const legacyTaskboardTemp = path.join(sessionsDir, 'session.taskboard.json.tmp');
  const ordinaryTemp = path.join(sessionsDir, 'notes.tmp');
  const workspaceTemp = path.join(workspaceDir, 'draft.json.4321.123e4567-e89b-42d3-a456-426614174000.tmp');
  await Promise.all([
    fs.writeFile(atomicTemp, 'partial'),
    fs.writeFile(storageTemp, 'partial'),
    fs.writeFile(legacyTaskboardTemp, 'partial'),
    fs.writeFile(ordinaryTemp, 'keep'),
    fs.writeFile(workspaceTemp, 'keep'),
  ]);

  const result = await recoverStartupState(dataDir);

  assert.equal(result.crashedRuns, 1);
  assert.equal(result.removedTempFiles, 3);
  assert.deepEqual(result.releasedAgents, [
    'agentA (busy)',
    'agentA (status:tradewind→idle)',
  ]);
  const registry = JSON.parse(await fs.readFile(registryFile, 'utf8'));
  assert.equal(registry.agentA.busy, false);
  assert.equal(registry.agentA.status, 'idle');
  assert.equal(registry.agentB.status, 'offline');
  const meta = JSON.parse(await fs.readFile(path.join(runDir, 'meta.json'), 'utf8'));
  assert.equal(meta.status, 'crashed');
  assert.equal(typeof meta.endTime, 'string');
  await Promise.all([
    assert.rejects(fs.access(atomicTemp)),
    assert.rejects(fs.access(storageTemp)),
    assert.rejects(fs.access(legacyTaskboardTemp)),
  ]);
  assert.equal(await fs.readFile(ordinaryTemp, 'utf8'), 'keep');
  assert.equal(await fs.readFile(workspaceTemp, 'utf8'), 'keep');
});
