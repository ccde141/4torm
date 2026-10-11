import assert from 'node:assert/strict';
import test from 'node:test';
import type { CollaborationContext } from '../../../engine/collaboration/contracts.js';
import { CollaborationRouter } from '../../../engine/collaboration/router.js';
import { createCycloneModule } from './module.js';
import type { CycloneCommands } from '../application/execution-commands.js';
import type { CycloneWorkshopService } from '../application/workshop-service.js';
import type { CycloneSeatService } from '../application/seat-service.js';
import type { CycloneRoomService } from '../application/room-service.js';
import type { CycloneChairService } from '../application/chair-service.js';
import type { CycloneCollaborationService } from '../application/collaboration-service.js';
import type { CycloneDispatchService } from '../application/dispatch-service.js';
import { CycloneCollaborationRoundService } from '../application/collaboration-round.js';

const context: CollaborationContext = {
  actor: { type: 'human', id: 'human', actingAs: 'human' }, audience: 'human',
  enabledFeatures: new Set(['cyclone']), permissions: new Set(['observe']), requestId: 'req-1',
};

test('气旋将工作室与持久派发投影为统一父子探针', async () => {
  const router = new CollaborationRouter([createCycloneModule({ source: {
    snapshots: async () => [{
      operationId: 'cyc-1', title: '发布工作室', status: 'running',
      updatedAt: '2026-09-30T02:00:00.000Z',
    }, {
      operationId: 'dispatch:dispatch-1', parentOperationId: 'cyc-1',
      title: '派发至测试工位', status: 'waiting', phase: 'dispatch',
      updatedAt: '2026-09-30T02:00:00.000Z', waitingReason: '等待工位补充信息',
    }],
  }, commands: commands(), workshops: workshopStub(), seats: seatStub(), rooms: roomStub(),
  chair: chairStub(), collaborations: collaborationStub(), dispatches: dispatchStub() })]);

  const result = await router.observe('cyclone', { view: 'summary' }, context);
  assert.deepEqual(result.items, [{
    operationId: 'cyc-1', title: '发布工作室', status: 'running',
    updatedAt: '2026-09-30T02:00:00.000Z',
  }, {
    operationId: 'dispatch:dispatch-1', parentOperationId: 'cyc-1',
    title: '派发至测试工位', status: 'waiting', phase: 'dispatch',
    updatedAt: '2026-09-30T02:00:00.000Z', waitingReason: '等待工位补充信息',
  }]);
});

test('气旋探针分页时不把派发正文带入中心', async () => {
  const router = new CollaborationRouter([createCycloneModule({ source: {
    snapshots: async () => ['1', '2', '3'].map(id => ({
      operationId: `cyc-${id}`, title: `工作室 ${id}`, status: 'idle' as const,
      updatedAt: `2026-09-${id.padStart(2, '0')}T00:00:00.000Z`,
    })),
  }, commands: commands(), workshops: workshopStub(), seats: seatStub(), rooms: roomStub(),
  chair: chairStub(), collaborations: collaborationStub(), dispatches: dispatchStub() })]);
  const first = await router.observe('cyclone', { limit: 2 }, context);
  assert.equal(first.items.length, 2);
  assert.equal(first.truncated, true);
  assert.ok(first.nextCursor);
  const second = await router.observe('cyclone', { limit: 2, cursor: first.nextCursor }, context);
  assert.equal(second.items.length, 1);
  assert.equal(second.truncated, false);
  assert.equal(JSON.stringify([...first.items, ...second.items]).includes('task'), false);
});

test('气旋只公开带运行身份的中止命令，不暴露内部开始与完成步骤', async () => {
  const calls: string[] = [];
  const module = createCycloneModule({
    source: { snapshots: async () => [{
      operationId: 'seat:cyc-1:seat-1', title: '工位', status: 'running',
      runId: 'cyclone-run-1',
    }] },
    commands: commands({
      abort: async input => { calls.push(`abort:${input.runId}`); return { stopped: true, ...input }; },
    }),
    workshops: workshopStub(),
    seats: seatStub(),
    rooms: roomStub(),
    chair: chairStub(),
    collaborations: collaborationStub(),
    dispatches: dispatchStub(),
  });
  assert.equal(module.manifest.methods.some(method => method.id === 'beginExecution'), false);
  assert.equal(module.manifest.methods.some(method => method.id === 'finishExecution'), false);
  const router = new CollaborationRouter([module]);
  const executable = { ...context, permissions: new Set(['observe', 'intervene']) };
  await router.invoke({ feature: 'cyclone', method: 'abortExecution', input: {
    operationId: 'seat:cyc-1:seat-1', runId: 'cyclone-run-1',
  } }, executable);
  assert.deepEqual(calls, ['abort:cyclone-run-1']);
});

test('气旋工作区通过中心管理方法打开', async () => {
  const calls: string[] = [];
  const workshops = {
    openWorkspace: async (workshopId: string) => {
      calls.push(workshopId);
      return `workspace/${workshopId}`;
    },
  } as CycloneWorkshopService;
  const router = new CollaborationRouter([createCycloneModule({
    source: { snapshots: async () => [] }, commands: commands(), workshops,
    seats: seatStub(), rooms: roomStub(), chair: chairStub(),
    collaborations: collaborationStub(),
    dispatches: dispatchStub(),
  })]);
  const result = await router.invoke({
    feature: 'cyclone', method: 'openWorkshopWorkspace', input: { workshopId: 'workshop-1' },
  }, { ...context, permissions: new Set(['administer']) });
  assert.deepEqual(result, { ok: true, path: 'workspace/workshop-1' });
  assert.deepEqual(calls, ['workshop-1']);
});

test('Agent 高层协作轮次返回中心可核验的运行句柄', async () => {
  let active = false;
  const rooms = roomStub();
  rooms.require = async () => ({
    id: 'room-1', title: '大厅', topic: '', participantSeatIds: ['seat-1'],
    publicMessages: [], createdAt: 'now', updatedAt: 'now',
  });
  const rounds = new CycloneCollaborationRoundService({
    prepare: async () => {
      active = true;
      return {
        execution: { workshopId: 'cyc-1', targetKind: 'room', targetId: 'room-1',
          phase: 'room-speak', operationId: 'room:cyc-1:room-1', runId: 'run-1', startedAt: 'now' },
        run: async () => undefined,
      };
    },
  }, rooms);
  const router = new CollaborationRouter([createCycloneModule({
    source: { snapshots: async () => active ? [{
      operationId: 'room:cyc-1:room-1', parentOperationId: 'cyc-1', title: '大厅',
      status: 'running', phase: 'room-speak', runId: 'run-1',
    }] : [] },
    commands: commands(), workshops: workshopStub(), seats: seatStub(), rooms,
    chair: chairStub(), collaborations: collaborationStub(), collaborationRounds: rounds,
    dispatches: dispatchStub(),
  })]);

  const result = await router.invoke({ feature: 'cyclone', method: 'startCollaborationRound', input: {
    workshopId: 'cyc-1', roomId: 'room-1', message: '开始评审',
  } }, { ...context, actor: { type: 'agent', id: 'main', actingAs: 'human' }, audience: 'agent',
    permissions: new Set(['observe', 'execute']) });
  assert.equal((result as { runId: string }).runId, 'run-1');
});

function commands(overrides: Partial<CycloneCommands> = {}): CycloneCommands {
  return {
    begin: async input => ({ ...input, operationId: `${input.targetKind}:${input.workshopId}:${input.targetId}`,
      runId: 'cyclone-run-default', startedAt: '2026-09-30T00:00:00.000Z' }),
    abort: async input => ({ stopped: true, ...input }),
    finish: async input => ({ finished: true, ...input }),
    ...overrides,
  };
}

function workshopStub(): CycloneWorkshopService {
  return {} as CycloneWorkshopService;
}

function seatStub(): CycloneSeatService {
  return {} as CycloneSeatService;
}

function roomStub(): CycloneRoomService {
  return {} as CycloneRoomService;
}

function chairStub(): CycloneChairService {
  return {} as CycloneChairService;
}

function collaborationStub(): CycloneCollaborationService {
  return {} as CycloneCollaborationService;
}

function dispatchStub(): CycloneDispatchService {
  return {} as CycloneDispatchService;
}
