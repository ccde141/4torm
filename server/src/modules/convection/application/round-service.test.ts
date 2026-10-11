import assert from 'node:assert/strict';
import test from 'node:test';
import type { ConvectionCommands } from './round-commands.js';
import type { ConvectionRoundExecutionPort } from '../domain/session-snapshot.js';
import type { ConvectionRoundExecutor } from './round-executor.js';
import type { ConvectionSessionService } from './session-service.js';
import { ConvectionRoundService } from './round-service.js';
import { ConvectionConferenceFeed } from './conference-feed.js';

test('Agent 后台轮次与人类流式轮次共享会议事件源', async () => {
  const feed = new ConvectionConferenceFeed();
  const types: string[] = [];
  let terminalSawLive = false;
  let service!: ConvectionRoundService;
  feed.subscribe(event => {
    types.push(event.type);
    if (event.type === 'round-end') terminalSawLive = service.liveSnapshot('conv-a') !== null;
  });
  service = new ConvectionRoundService(sessions(), commands([]), rounds(), {
    speak: async (_session, _message, emit) => {
      emit({ type: 'agent-start', agentId: 'agent-a', label: '成员' });
      emit({ type: 'token', agentId: 'agent-a', label: '成员', chunk: '正在发言' });
    },
  } as unknown as ConvectionRoundExecutor, feed);
  await service.start({ sessionId: 'conv-a', round: 'public', message: '议题' });
  await service.drain();
  assert.deepEqual(types, ['round-start', 'round-event', 'round-event', 'round-end']);
  assert.equal(terminalSawLive, false);
});

test('Agent 启动对流后立即取得句柄，执行完成后记录终态', async () => {
  const calls: string[] = [];
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const service = new ConvectionRoundService(
    sessions(), commands(calls), rounds(), {
      speak: async () => { calls.push('execute'); await pending; },
    } as unknown as ConvectionRoundExecutor,
  );
  const receipt = await service.start({ sessionId: 'conv-a', round: 'public', message: '开始' });
  assert.equal(receipt.runId, 'run-a');
  assert.deepEqual(calls, ['begin', 'execute']);
  release();
  await service.drain();
  assert.deepEqual(calls, ['begin', 'execute', 'finish:completed']);
});

test('公开讨论与主席私聊都把同一轮次 ID 传到消息写入端', async () => {
  const received: string[] = [];
  const service = new ConvectionRoundService(sessions(), commands([]), rounds(), {
    speak: async (_session, _message, _emit, _signal, runId) => { received.push(`public:${runId}`); },
    chair: async (_session, _message, _emit, _signal, runId) => { received.push(`chair:${runId}`); },
  } as unknown as ConvectionRoundExecutor);
  await service.start({ sessionId: 'conv-a', round: 'public', message: '议题' });
  await service.drain();
  await service.start({ sessionId: 'conv-a', round: 'chair', message: '私聊' });
  await service.drain();
  assert.deepEqual(received, ['public:run-a', 'chair:run-a']);
});

test('既有无人会议不能启动公开轮次，也不产生假完成记录', async () => {
  const calls: string[] = [];
  const service = new ConvectionRoundService({ require: async () => ({
    id: 'conv-empty', participantAgentIds: [],
  }) } as ConvectionSessionService, commands(calls), rounds(), {
    speak: async () => { calls.push('execute'); },
  } as unknown as ConvectionRoundExecutor);
  await assert.rejects(service.start({ sessionId: 'conv-empty', round: 'public', message: '开始' }),
    error => (error as { data?: { code?: string } }).data?.code === 'CONVECTION_NO_PARTICIPANTS');
  assert.deepEqual(calls, []);
});

test('运行中保留最新内存发言快照，完成后清除草稿', async () => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const session = { id: 'conv-a', participantAgentIds: ['agent-a'],
    publicMessages: [], chairMessages: [] };
  const service = new ConvectionRoundService({ require: async () => session } as ConvectionSessionService,
    commands([]), rounds(), { speak: async (_session, _message, emit) => {
      emit({ type: 'agent-start', agentId: 'agent-a', label: '成员' });
      emit({ type: 'token', agentId: 'agent-a', label: '成员', chunk: '进行' });
      await pending;
    } } as unknown as ConvectionRoundExecutor);
  await service.start({ sessionId: 'conv-a', round: 'public', message: '开始' });
  assert.equal(service.liveSnapshot('conv-a')?.draft, '进行');
  release();
  await service.drain();
  assert.equal(service.liveSnapshot('conv-a'), null);
});

test('人类流式轮次与 Agent 后台轮次共用服务并转发执行事件', async () => {
  const calls: string[] = [];
  const streamed: unknown[] = [];
  const service = new ConvectionRoundService(
    sessions(), commands(calls), rounds(), {
      speak: async (_session, message, emit) => {
        calls.push(`execute:${message}`);
        emit({ type: 'notice', message });
      },
    } as unknown as ConvectionRoundExecutor,
  );

  const prepared = await service.prepare({
    sessionId: 'conv-a', round: 'public', message: '开始',
  });
  assert.equal(prepared.receipt.runId, 'run-a');
  await prepared.run(event => streamed.push(event));

  assert.deepEqual(streamed, [{ type: 'notice', message: '开始' }]);
  assert.deepEqual(calls, ['begin', 'execute:开始', 'finish:completed']);
});

test('对流记录只归属本轮实际开始执行的 Agent', async () => {
  let attributed: string[] | undefined;
  const commandPort = commands([]);
  const service = new ConvectionRoundService(
    sessions(), { ...commandPort, finish: async input => {
      attributed = input.agentIds;
      return { ...input, finished: true };
    } }, rounds(), {
      speak: async (_session, _message, emit) => {
        emit({ type: 'agent-start', agentId: 'agent-a', label: 'A' });
        emit({ type: 'agent-done', agentId: 'agent-a', label: 'A',
          content: '完成', rawContent: '完成' });
      },
    } as unknown as ConvectionRoundExecutor,
  );
  await service.start({ sessionId: 'conv-a', round: 'public', message: '开始' });
  await service.drain();
  assert.deepEqual(attributed, ['agent-a']);
});

test('对流后台执行失败与退出中止都形成明确终态', async () => {
  const failed: string[] = [];
  const failure = new ConvectionRoundService(
    sessions(), commands(failed), rounds(), {
      speak: async () => { throw new Error('model failed'); },
    } as unknown as ConvectionRoundExecutor,
  );
  await failure.start({ sessionId: 'conv-a', round: 'public', message: '开始' });
  await failure.drain();
  assert.deepEqual(failed, ['begin', 'finish:failed:model failed']);

  const aborted: string[] = [];
  const controller = new AbortController();
  const stopping = new ConvectionRoundService(
    sessions(), commands(aborted, controller), rounds(controller.signal), {
      speak: async (_session, _message, _emit, signal) => new Promise<void>(resolve => {
        signal.addEventListener('abort', () => resolve(), { once: true });
      }),
    } as unknown as ConvectionRoundExecutor,
  );
  await stopping.start({ sessionId: 'conv-a', round: 'public', message: '开始' });
  await stopping.shutdown();
  assert.deepEqual(aborted, ['begin', 'abort', 'finish:aborted']);
  await assert.rejects(
    stopping.start({ sessionId: 'conv-a', round: 'public', message: '再次开始' }),
    error => (error as { data?: { code?: string } }).data?.code === 'CONVECTION_RUNTIME_CLOSING',
  );
});

function sessions(): ConvectionSessionService {
  return { require: async () => ({ id: 'conv-a', participantAgentIds: ['agent-a'] } as never),
  } as ConvectionSessionService;
}

function rounds(signal = new AbortController().signal): ConvectionRoundExecutionPort {
  return { snapshot: () => null, signal: () => signal };
}

function commands(calls: string[], controller?: AbortController): ConvectionCommands {
  return {
    begin: async input => {
      calls.push('begin');
      return { ...input, runId: 'run-a', startedAt: '2026-09-30T00:00:00.000Z' };
    },
    abort: async input => { calls.push('abort'); controller?.abort(); return { ...input, stopped: true }; },
    finish: async input => {
      calls.push(`finish:${input.status}${input.error ? `:${input.error}` : ''}`);
      return { ...input, finished: true };
    },
  };
}
