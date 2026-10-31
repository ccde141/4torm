import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import sharp from 'sharp';
import { CollaborationRouter } from '../engine/collaboration/router.js';
import { toolMediaRoutes } from './tool-media.js';
import { installFrameworkErrorHandler } from './error-handler.js';
import { installHumanIdentityPort } from './collaboration-context.js';
import { createMonsoonFeature } from '../modules/monsoon/public.js';
import { createConvectionFeature } from '../modules/convection/public.js';
import { createCycloneFeature } from '../modules/cyclone/public.js';
import { createTradewindFeature } from '../modules/tradewind/public.js';
import { createTideFeature } from '../modules/tide/public.js';
import { tideRunsDir } from '../services/data-paths.js';
import { saveSeat } from '../engine/cyclone/seat-store.js';
import { persistMcpToolOutcome } from '../engine/shared/tool-media-store.js';
import { execToolUnifiedOutcome } from '../engine/shared/exec-tool.js';

const timestamp = '2026-10-21T00:00:00.000Z';
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

async function fixture(t: { after(callback: () => Promise<unknown>): void }, bytes = png) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-tool-image-http-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  await fs.mkdir(path.join(dataDir, 'agents'), { recursive: true });
  await fs.writeFile(path.join(dataDir, 'agents/registry.json'), JSON.stringify({
    chair: { id: 'chair', name: 'Chair', config: {} }, member: { id: 'member', name: 'Member', config: {} },
  }));
  const outcome = await persistMcpToolOutcome(dataDir, { result: 'metadata', ok: true,
    inlineImages: [{ mimeType: 'image/png', data: bytes.toString('base64') }] });
  const image = outcome.toolImages![0];
  const monsoon = createMonsoonFeature({ dataDir });
  const convection = createConvectionFeature({ dataDir });
  const cyclone = createCycloneFeature({ dataDir });
  t.after(async () => { await cyclone.shutdown(); cyclone.dispose(); });
  const tradewind = createTradewindFeature({ dataDir });
  const tide = createTideFeature({ dataDir, seasonSessions: monsoon.externalSessions });
  const router = new CollaborationRouter([monsoon.module, convection.module, cyclone.module,
    tradewind.module, tide.module]);
  const app = Fastify();
  installFrameworkErrorHandler(app);
  await app.register(toolMediaRoutes, { prefix: '/api/tool-media', router });
  t.after(() => app.close());
  const read = (feature: string, target: Record<string, string>, id = image.id) => app.inject({
    method: 'GET', url: `/api/tool-media/${feature}/${id}?${new URLSearchParams(target)}`,
  });
  return { dataDir, app, router, image, monsoon, convection, cyclone, tide, read };
}

test('五个功能岛的真实公开传输口只能读取其所属会话或执行中的工具图片', async t => {
  const f = await fixture(t);
  await f.monsoon.sessions.create({ id: 'session-a', agentId: 'member', agentName: 'Member', title: 'Images',
    model: 'fixture', systemPrompt: '', createdAt: timestamp, updatedAt: timestamp,
    messages: [{ id: 'answer', role: 'assistant', content: 'done', timestamp,
      nativeContext: [{ role: 'tool', content: 'metadata', toolCallId: 'one', toolImages: [f.image] }] }] });
  const meeting = await f.convection.sessions.create({ chairAgentId: 'chair', participantAgentIds: ['member'] });
  meeting.publicMessages.push({ speaker: 'Member', content: 'done', timestamp: Date.parse(timestamp),
    toolCalls: [{ tool: 'capture', args: {}, result: 'metadata', toolImages: [f.image] }] });
  await f.convection.sessions.save(meeting);
  const workshop = await f.cyclone.workshops.create({ title: 'Images' });
  const seat = await f.cyclone.workshops.addSeat({ workshopId: workshop.id, agentId: 'member' });
  seat.messages.push({ role: 'tool', content: 'metadata', toolImages: [f.image] });
  await saveSeat(f.dataDir, workshop.id, seat);
  const runDir = path.join(f.dataDir, 'tradewind/runs/workflow-a/run-a');
  await fs.mkdir(path.join(runDir, 'nodes/node-a'), { recursive: true });
  await fs.writeFile(path.join(runDir, 'meta.json'), JSON.stringify({ workflowId: 'workflow-a',
    executionId: 'run-a', startTime: timestamp, status: 'completed' }));
  await fs.writeFile(path.join(runDir, 'nodes/node-a/messages.json'), JSON.stringify([
    { role: 'tool', content: 'metadata', toolImages: [f.image] },
  ]));
  const task = await f.tide.tasks.create({ name: 'Images', agentId: 'member', prompt: 'test', schedule: 'daily 08:00' }, { enabled: false });
  const tideRunDirectory = tideRunsDir(f.dataDir, task.id);
  await fs.mkdir(tideRunDirectory, { recursive: true });
  await fs.writeFile(path.join(tideRunDirectory, '2026-10-21T00-00-00.000Z-run-a.json'), JSON.stringify({ taskId: task.id, runId: 'run-a', timestamp,
    status: 'success', agentId: 'member', sessionId: 'archived', sessionState: 'archived',
    answer: 'done', rawContent: 'done', turns: 1, durationMs: 1,
    toolCalls: [{ tool: 'capture', args: { count: 1 }, result: 'metadata', toolImages: [f.image] }] }));
  const targets = [
    ['monsoon', { agentId: 'member', sessionId: 'session-a' }],
    ['convection', { sessionId: meeting.id }],
    ['cyclone', { workshopId: workshop.id, kind: 'seat', targetId: seat.id }],
    ['tradewind', { workflowId: 'workflow-a', executionId: 'run-a', nodeId: 'node-a', kind: 'node' }],
    ['tide', { taskId: task.id, runId: 'run-a' }],
  ] as const;
  const snapshot = await f.router.invoke({ feature: 'tradewind', method: 'readNodeSnapshot',
    input: { workflowId: 'workflow-a', executionId: 'run-a', nodeId: 'node-a' } }, {
    actor: { type: 'human', id: 'test', actingAs: 'human' }, audience: 'human',
    enabledFeatures: new Set(['tradewind']), permissions: new Set(['observe']), requestId: 'snapshot',
  }) as { messages: Array<{ toolSteps?: unknown[] }> };
  assert.ok(Array.isArray(snapshot.messages));
  for (const [feature, target] of targets) {
    const result = await f.read(feature, target);
    assert.equal(result.statusCode, 200, `${feature}: ${result.body}`);
    assert.equal(result.headers['content-type'], 'image/png');
    assert.equal(result.headers['cache-control'], 'private, no-store');
    assert.deepEqual(result.rawPayload, png);
    const otherImage = await f.read(feature, target, 'f4f82d73-4c42-4b3f-95b5-a8646ab58d9f');
    assert.equal(otherImage.statusCode, 404, feature);
  }
  assert.equal((await f.read('monsoon', { agentId: 'chair', sessionId: 'session-a' })).statusCode, 404);
  assert.equal((await f.read('cyclone', { workshopId: 'another-workshop', kind: 'seat', targetId: seat.id })).statusCode, 404);
  assert.equal((await f.read('tradewind', { workflowId: 'another-workflow', executionId: 'run-a', nodeId: 'node-a', kind: 'node' })).statusCode, 404);
});

test('工具刚返回而会话尚未提交时，只有框架登记的同一完整作用域能查看截图', async t => {
  const f = await fixture(t);
  for (const id of ['live', 'other']) await f.monsoon.sessions.create({ id, agentId: 'member', agentName: 'Member',
    title: id, model: 'fixture', systemPrompt: '', createdAt: timestamp, updatedAt: timestamp, messages: [] });
  await execToolUnifiedOutcome({ tool: 'mcp:fixture:capture', args: {}, agentId: 'member',
    mediaAccess: { dataDir: f.dataDir, feature: 'monsoon', target: { agentId: 'member', sessionId: 'live' } } }, {
    callMcp: async () => { throw new Error('wrong path'); },
    callMcpOutcome: async () => ({ result: 'metadata', ok: true, toolImages: [f.image] }),
    fetcher: async () => { throw new Error('wrong transport'); },
  });
  assert.equal((await f.read('monsoon', { agentId: 'member', sessionId: 'live' })).statusCode, 200);
  assert.equal((await f.read('monsoon', { agentId: 'member', sessionId: 'other' })).statusCode, 404);
  const unknown = await f.read('monsoon', { agentId: 'member', sessionId: 'live', path: '../outside' });
  assert.equal(unknown.statusCode, 400);
  assert.equal((await f.read('monsoon', { agentId: 'member', sessionId: '..' })).statusCode, 400);
});

test('图片读取经过人类observe权限校验，不凭媒体ID绕过功能区权限', async t => {
  const f = await fixture(t);
  const app = Fastify();
  installFrameworkErrorHandler(app);
  installHumanIdentityPort(app, { resolve: () => ({ id: 'viewer', enabledFeatures: ['monsoon'], permissions: [] }) });
  await app.register(toolMediaRoutes, { router: f.router });
  t.after(() => app.close());
  const result = await app.inject({ method: 'GET',
    url: `/monsoon/${f.image.id}?agentId=member&sessionId=live` });
  assert.equal(result.statusCode, 403);
});

test('authorized previews use bounded WebP while original reads stay byte-identical', async t => {
  const original = await sharp({ create: { width: 2400, height: 1600, channels: 3,
    background: '#773399' } }).png().toBuffer();
  const f = await fixture(t, original);
  await f.monsoon.sessions.create({ id: 'preview-session', agentId: 'member', agentName: 'Member',
    title: 'Preview fixture', model: 'fixture', systemPrompt: '', createdAt: timestamp, updatedAt: timestamp,
    messages: [{ id: 'answer', role: 'assistant', content: 'done', timestamp,
      toolSteps: [{ tool: 'read_image', args: {}, status: 'done', toolImages: [f.image] }] }] });
  const target = { agentId: 'member', sessionId: 'preview-session' };
  const result = await f.read('monsoon', { ...target, preview: '1' });
  assert.equal(result.statusCode, 200, result.body);
  assert.match(String(result.headers['content-type']), /^image\/webp/);
  const dimensions = await sharp(result.rawPayload).metadata();
  assert.equal(dimensions.width, 640);
  assert.ok(dimensions.height! <= 640);
  assert.deepEqual((await f.read('monsoon', target)).rawPayload, original);
  // This request hits the preview cache only after checking the new owner's access.
  assert.equal((await f.read('monsoon', { agentId: 'chair', sessionId: 'preview-session', preview: '1' })).statusCode, 404);
  assert.equal((await f.read('monsoon', { ...target, preview: 'original' })).statusCode, 400);
  await fs.unlink(path.join(f.dataDir, 'mcp', 'media', `${f.image.id}.png`));
  const missing = await f.read('monsoon', { ...target, preview: '1' });
  assert.equal(missing.statusCode, 404);
  assert.equal(missing.json().errorCode, 'TOOL_IMAGE_FILE_MISSING');
  assert.equal((await f.read('monsoon', target)).statusCode, 404);
});

test('a corrupt preview does not silently deliver the original image', async t => {
  const f = await fixture(t);
  await f.monsoon.sessions.create({ id: 'broken-preview', agentId: 'member', agentName: 'Member',
    title: 'Broken preview fixture', model: 'fixture', systemPrompt: '', createdAt: timestamp, updatedAt: timestamp,
    messages: [{ id: 'answer', role: 'assistant', content: 'done', timestamp,
      toolSteps: [{ tool: 'capture', args: {}, status: 'done', toolImages: [f.image] }] }] });
  const result = await f.read('monsoon', { agentId: 'member', sessionId: 'broken-preview', preview: '1' });
  assert.equal(result.statusCode, 400);
  assert.equal(result.json().errorCode, 'TOOL_IMAGE_PREVIEW_UNAVAILABLE');
});
