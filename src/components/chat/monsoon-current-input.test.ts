import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LocaleProvider } from '../../i18n/LocaleContext';
import type { Agent } from '../../types';
import type { ChatSession } from '../../store/chat';
import { applyModelRequest } from '../../lib/model-usage';

registerHooks({ load(url, context, next) {
  return url.endsWith('.css') ? { format: 'module', source: '', shortCircuit: true } : next(url, context);
} });
const { MonsoonSidebar } = await import('./MonsoonSidebar');
const agent = { id: 'agent-fixture', name: 'Fixture', status: 'idle' } as Agent;
const base: ChatSession = { id: 'session-fixture', agentId: agent.id, agentName: 'Fixture', title: 'Fixture',
  model: 'fixture:model', systemPrompt: '', messages: [], createdAt: '', updatedAt: '' };
const noop = () => {};
function render(session: ChatSession) {
  return renderToStaticMarkup(createElement(LocaleProvider, null, createElement(MonsoonSidebar, {
    agents: [agent], offlineIds: new Set<string>(), selectedAgent: agent, sessions: [session],
    activeSessionId: session.id, selectAgent: noop, selectSession: noop, newSession: noop,
    deleteSession: noop,
  })));
}

test('only a fresh empty session has no input preview; compaction-only metering cannot hide a current estimate', () => {
  assert.match(render(base), /class="session-item__tokens"[^>]*>--<\/span>/);
  const modelUsage = applyModelRequest(undefined, { id: 'summary', purpose: 'compaction', state: 'completed',
    estimatedInputTokens: 2000, imageCount: 0, usageComplete: false,
    startedAt: '2026-10-24T00:00:00Z', updatedAt: '2026-10-24T00:00:01Z' });
  const currentInput = { tokens: 384, images: 0, model: base.model, estimatedAt: '2026-10-24T00:00:02Z' };
  assert.match(render({ ...base, modelUsage, currentInput }), /class="session-item__tokens"[^>]*>384<\/span>/);
});

test('a smaller current context replaces a larger historical measurement in the real sidebar', () => {
  const session = { ...base, tokenUsage: { promptTokens: 9000, completionTokens: 1000, totalTokens: 10000 },
    currentInput: { tokens: 12000, images: 0, model: base.model, estimatedAt: '2026-10-24T00:00:02Z' } };
  assert.match(render(session), />12\.0K<\/span>/);
  assert.match(render({ ...session, currentInput: { ...session.currentInput, tokens: 80 } }), />80<\/span>/);
});
