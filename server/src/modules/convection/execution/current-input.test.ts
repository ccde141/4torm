import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { estimateCurrentInput } from '../../../engine/shared/llm-bridge.js';
import { observeModelRequests, type ModelRequestUsageEvent } from '../../../engine/shared/model-request-usage.js';
import { resolveToolTransportContract } from '../../../model-runtime/config/tool-transport-contract.js';
import { ConvectionSessionService } from '../application/session-service.js';
import { rememberChairContextBoundary } from './chair-context.js';
import { readConvectionCurrentInput } from './current-input.js';
import { buildAgentMessages } from './participant-context.js';
import { buildConvectionChairMessages } from './request-context.js';
import { loadRequiredAgent } from './round-agent-snapshot.js';

async function fixture(t: TestContext, textMode = false) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-convection-input-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  await fs.mkdir(path.join(dataDir, 'agents'), { recursive: true });
  await fs.writeFile(path.join(dataDir, 'agents', 'registry.json'), JSON.stringify({
    chair: { name: 'Chair', model: 'fixture:chair', config: { tools: [], toolMode: 'selected' } },
    participant: { name: 'Participant', model: 'fixture:participant',
      config: { tools: ['read_file'], toolMode: 'selected' } },
  }));
  const provider = { id: 'fixture', baseUrl: 'https://input-preview.invalid/v1',
    models: ['chair', 'participant'], providerType: 'openai-compatible' };
  await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ providers: [{ ...provider,
    ...(textMode ? { toolTransports: { participant: { status: 'text-required',
      fingerprint: resolveToolTransportContract(provider, 'participant').fingerprint } } } : {}),
  }] }));
  const service = new ConvectionSessionService(dataDir);
  const session = await service.create({ chairAgentId: 'chair', participantAgentIds: ['participant'], topic: 'Input preview' });
  return { dataDir, service, session };
}

test('公私预估复用实际提示词与工具结构，读取不发送模型请求或产生计量', async t => {
  const { dataDir, session } = await fixture(t);
  session.publicMessages.push({ speaker: '人类', content: '公开问题', timestamp: 1 });
  session.chairMessages.push({ role: 'user', content: '私人问题'.repeat(300) });
  const observations: ModelRequestUsageEvent[] = [];
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Read must not use network'); });
  const current = await observeModelRequests(event => observations.push(event),
    () => readConvectionCurrentInput(dataDir, session));
  const participant = await loadRequiredAgent(dataDir, 'participant');
  const built = await buildAgentMessages(dataDir, session, participant, true);
  const expectedPublic = await estimateCurrentInput({ dataDir, fullModelKey: participant.model,
    messages: built.messages, tools: built.toolDefs, options: { temperature: participant.temperature } });
  const withoutTools = await estimateCurrentInput({ dataDir, fullModelKey: participant.model, messages: built.messages });
  const expectedChair = await estimateCurrentInput({ dataDir, fullModelKey: 'fixture:chair',
    messages: buildConvectionChairMessages(session, 'Chair') });
  assert.equal(current.publicCurrentInput?.tokens, expectedPublic.tokens);
  assert.equal(current.chairCurrentInput?.tokens, expectedChair.tokens);
  assert.ok(expectedPublic.tokens > withoutTools.tokens, 'native tool schemas count in public input');
  assert.equal(current.publicCurrentInput?.basis, 'compiled');
  assert.deepEqual(observations, []);
  const before = current.publicCurrentInput?.tokens;
  session.chairMessages.push({ role: 'user', content: '只属于助理的历史'.repeat(500) });
  assert.equal((await readConvectionCurrentInput(dataDir, session)).publicCurrentInput?.tokens, before);
});

test('文本工具只计算提示词中的定义，不重复追加原生工具定义', async t => {
  const { dataDir, session } = await fixture(t, true);
  const agent = await loadRequiredAgent(dataDir, 'participant');
  const built = await buildAgentMessages(dataDir, session, agent, false);
  const expected = await estimateCurrentInput({ dataDir, fullModelKey: agent.model, messages: built.messages });
  const duplicated = await estimateCurrentInput({ dataDir, fullModelKey: agent.model,
    messages: built.messages, tools: built.toolDefs });
  const current = await readConvectionCurrentInput(dataDir, session);
  assert.equal(current.publicCurrentInput?.tokens, expected.tokens);
  assert.ok(expected.tokens < duplicated.tokens);
});

test('列表和状态在编辑、删除、清空后重新估算，历史实测和账本不被覆盖', async t => {
  const { dataDir, session, service } = await fixture(t);
  session.publicMessages.push({ speaker: '人类', content: '旧公开历史'.repeat(8_000), timestamp: 1 });
  session.publicLatestTokenUsage = { promptTokens: 99_999, completionTokens: 100, totalTokens: 100_099 };
  await service.save(session);
  const before = await service.read(session.id);
  await service.editMessage(session.id, 0, '缩短');
  const edited = await service.read(session.id);
  assert.ok(edited.publicCurrentInput!.tokens < before.publicCurrentInput!.tokens);
  assert.equal((await service.list())[0].publicCurrentInput?.tokens, edited.publicCurrentInput?.tokens);
  await service.deleteMessage(session.id, 0);
  const empty = await service.read(session.id);
  assert.ok(empty.publicCurrentInput!.tokens > 0, 'empty old context still has base instructions and tools');
  assert.ok(empty.publicCurrentInput!.tokens < edited.publicCurrentInput!.tokens);
  assert.equal(empty.publicLatestTokenUsage?.promptTokens, 99_999);
  assert.equal(empty.publicModelUsage, undefined);
  const persisted = JSON.parse(await fs.readFile(path.join(dataDir, 'convection', 'sessions', `${session.id}.json`), 'utf8'));
  assert.equal(persisted.publicCurrentInput, undefined, 'read-only estimates are not persisted as billable usage');
});

test('助理压缩后只估算有效摘要和保留内容，不叠加已归档可见历史', async t => {
  const { dataDir, session } = await fixture(t);
  session.publicMessages.push({ speaker: '人类', content: '旧公开发言'.repeat(3_000), timestamp: 1 });
  session.chairMessages.push({ role: 'user', content: '旧私聊'.repeat(3_000) });
  const before = await readConvectionCurrentInput(dataDir, session);
  session.chairActiveContext = [{ role: 'system', content: '[历史摘要] 已确认约定' }];
  rememberChairContextBoundary(session);
  const compacted = await readConvectionCurrentInput(dataDir, session);
  assert.ok(compacted.chairCurrentInput!.tokens < before.chairCurrentInput!.tokens / 2);
  assert.equal(compacted.publicCurrentInput?.tokens, before.publicCurrentInput?.tokens);
  session.chairMessages[0].content += '可见归档补充'.repeat(5_000);
  assert.equal((await readConvectionCurrentInput(dataDir, session)).chairCurrentInput?.tokens,
    compacted.chairCurrentInput?.tokens);
});

test('提供商配置删除仍返回本地预估，单个失效参与者不阻断会话读取', async t => {
  const { dataDir, service, session } = await fixture(t);
  await fs.writeFile(path.join(dataDir, 'providers.json'), JSON.stringify({ providers: [] }));
  session.participantAgentIds.push('missing');
  await service.save(session);
  const current = await service.read(session.id);
  assert.equal(current.publicCurrentInput?.basis, 'canonical');
  assert.equal(current.chairCurrentInput?.basis, 'canonical');
  assert.equal(current.publicCurrentInput?.model, 'fixture:participant');
  assert.equal((await service.list()).length, 1);
});
