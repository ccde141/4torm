import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createMonsoonInputPreview } from './current-input.js';
import type { MonsoonSession } from '../domain/session.js';

test('current input excludes pre-compaction history and follows edits and deletion immediately', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-monsoon-preview-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const preview = createMonsoonInputPreview(dataDir);
  const timestamp = '2026-10-24T01:00:00.000Z';
  const session: MonsoonSession = { id: 'session-fixture', agentId: 'agent-fixture', agentName: 'Fixture',
    title: 'Fixture', systemPrompt: 'System rules', model: 'removed:model', revision: 1, messageRevision: 1,
    createdAt: timestamp, updatedAt: timestamp, messages: [] };
  assert.equal((await preview(session)).currentInput, undefined);
  const message = { id: 'user', role: 'user' as const, content: 'History '.repeat(2000), timestamp };
  const full = await preview({ ...session, messages: [message] });
  const marker = { id: 'summary', role: 'system' as const, content: 'Concise summary', timestamp, type: 'compact-marker' };
  const compact = await preview({ ...session, messageRevision: 2, messages: [message, marker] });
  const compactAlone = await preview({ ...session, messageRevision: 2, messages: [marker] });
  assert.equal(compact.currentInput!.tokens, compactAlone.currentInput!.tokens);
  assert.ok(full.currentInput!.tokens > compact.currentInput!.tokens);
  const edited = await preview({ ...session, messageRevision: 3, messages: [{ ...message, content: 'Edited' }] });
  assert.ok(edited.currentInput!.tokens < full.currentInput!.tokens);
  const emptied = await preview({ ...session, messageRevision: 4 });
  assert.ok(emptied.currentInput!.tokens > 0);
  assert.equal(emptied.currentInput!.contextRevision, 4);
});
