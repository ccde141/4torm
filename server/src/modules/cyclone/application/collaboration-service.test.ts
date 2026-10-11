import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { agentRegistryFile } from '../../../services/data-paths.js';
import type { CycloneRoomService } from './room-service.js';
import type { CycloneWorkshopService } from './workshop-service.js';
import { CycloneCollaborationService } from './collaboration-service.js';

async function dataWithAgent(t: TestContext): Promise<string> {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-cyclone-group-service-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  await fs.mkdir(path.dirname(agentRegistryFile(dataDir)), { recursive: true });
  await fs.writeFile(agentRegistryFile(dataDir), JSON.stringify({
    'agent-a': { id: 'agent-a', name: '成员 A', model: 'test' },
  }));
  return dataDir;
}

test('协作组组装失败时删除未发布草稿', async t => {
  const dataDir = await dataWithAgent(t);
  const calls: string[] = [];
  const service = new CycloneCollaborationService(
    dataDir,
    workshops(calls),
    rooms(new Error('room failed')),
  );
  await assert.rejects(() => service.create(input()), /room failed/);
  assert.deepEqual(calls, ['draft', 'seat', 'discard']);
});

test('协作组回滚失败时同时保留原始与清理错误', async t => {
  const dataDir = await dataWithAgent(t);
  const service = new CycloneCollaborationService(
    dataDir,
    workshops([], new Error('discard failed')),
    rooms(new Error('room failed')),
  );
  await assert.rejects(() => service.create(input()), error => {
    const data = (error as { data?: { code?: string; details?: Record<string, unknown> } }).data;
    return data?.code === 'CYCLONE_GROUP_ROLLBACK_FAILED'
      && data.details?.original === 'room failed'
      && data.details?.rollback === 'discard failed';
  });
});

test('协作组读取合并最近发言并服从中心预算', async t => {
  const dataDir = await dataWithAgent(t);
  const service = new CycloneCollaborationService(
    dataDir,
    { summary: async () => ({
      id: 'cyc-1', title: '协作组', chairAgentId: 'agent-a', seats: [],
      rooms: [{ id: 'room-a', title: '大厅' }, { id: 'room-b', title: '复核' }],
      bulletin: { items: [] },
    }) } as unknown as CycloneWorkshopService,
    { require: async (_workshopId: string, roomId: string) => ({
      id: roomId, title: roomId === 'room-a' ? '大厅' : '复核', topic: '发布',
      participantSeatIds: [],
      publicMessages: roomId === 'room-a'
        ? [{ speaker: '架构', content: '早期内容', timestamp: 1 }]
        : [{ speaker: '复核', content: '最新结论', timestamp: 2 }],
    }) } as unknown as CycloneRoomService,
  );

  const view = await service.read('cyc-1', { items: 1, textChars: 100, textLines: 5 });
  assert.deepEqual(view.messages, [{
    roomId: 'room-b', roomTitle: '复核', speaker: '复核', content: '最新结论', timestamp: 2,
  }]);
  assert.equal(view.truncated, true);
});

function input() {
  return {
    title: '协作组', members: [{ agentId: 'agent-a', title: '成员' }],
    room: { title: '大厅', topic: '协作' },
  };
}

function workshops(calls: string[], discardError?: Error): CycloneWorkshopService {
  return {
    createDraft: async () => {
      calls.push('draft');
      return { id: 'cyc-1', title: '协作组', seatIds: [], roomIds: [],
        createdAt: 'now', updatedAt: 'now' };
    },
    addSeat: async () => {
      calls.push('seat');
      return { id: 'seat-1', agentId: 'agent-a', title: '成员' };
    },
    publish: async () => { calls.push('publish'); },
    discard: async () => {
      calls.push('discard');
      if (discardError) throw discardError;
    },
  } as unknown as CycloneWorkshopService;
}

function rooms(error: Error): CycloneRoomService {
  return { create: async () => { throw error; } } as unknown as CycloneRoomService;
}
