import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { getAgentRuntimeStatus } from './agent-runtime-status.js';

test('dashboard status tokens use green, yellow and red', async () => {
  const css = await fs.readFile(
    new URL('../../styles/variables/tokens.css', import.meta.url),
    'utf8',
  );
  assert.match(css, /--status-idle:\s*#4ade80;/);
  assert.match(css, /--status-busy:\s*#fbbf24;/);
  assert.match(css, /--status-offline:\s*#ef4444;/);
});

test('idle, busy and offline remain the only dashboard tones', () => {
  assert.deepEqual(getAgentRuntimeStatus({ busy: false }, false), {
    tone: 'idle', label: '空闲', surfaces: '',
  });
  assert.deepEqual(getAgentRuntimeStatus({ busy: true, activeSurfaces: ['conversation'] }, false), {
    tone: 'busy', label: '工作中', surfaces: '季风',
  });
  assert.deepEqual(getAgentRuntimeStatus({ busy: true }, true), {
    tone: 'offline', label: '离线', surfaces: '',
  });
});

test('multiple feature sources are appended in stable order without duplicates', () => {
  const status = getAgentRuntimeStatus({
    busy: true,
    activeSurfaces: ['tide', 'conversation', 'tide', 'cyclone'],
  }, false);

  assert.deepEqual(status, {
    tone: 'busy', label: '工作中', surfaces: '季风、气旋、潮汐',
  });
});
