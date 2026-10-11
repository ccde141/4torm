import assert from 'node:assert/strict';
import test from 'node:test';
import { FrameworkError } from '../../../engine/shared/framework-error.js';
import type { LoadedAgent } from '../../../engine/shared/agent-loader.js';
import type { MonsoonTurn, MonsoonTurnSpec } from '../runtime/turn-contract.js';
import {
  MonsoonChatPreparation, type MonsoonChatPorts, type MonsoonChatRuntimePort,
} from './chat-preparation.js';

const agent: LoadedAgent = {
  id: 'agent-a', name: 'Agent A', model: 'provider:model-a', rolePrompt: 'role',
  temperature: 0.4, tools: [], toolMode: 'selected', skills: [], workspace: 'workspace-a',
  sandboxLevel: 'project',
};

function runner(busy = false): MonsoonTurn {
  return {
    isBusy: () => busy, isSuspended: () => false, getAgentId: () => 'agent-a',
    getModel: () => 'provider:model-a', getInputRuntime: () => null, abort: () => {},
  } as unknown as MonsoonTurn;
}

function runtimePort(value: MonsoonTurn, events: string[]): MonsoonChatRuntimePort {
  return {
    prepare: async () => { events.push('prepare'); return value; },
    fail: () => { events.push('fail'); },
  };
}

function ports(events: string[]): MonsoonChatPorts {
  return {
    loadAgent: async () => { events.push('agent'); return agent; },
    resolveNativeMode: async () => { events.push('native'); return { native: true }; },
    compileContext: async request => {
      events.push('context');
      return {
        systemPrompt: 'SYSTEM',
        chatMessages: [
          { role: 'system', content: 'SYSTEM' },
          ...request.input.messages.map(message => ({
            role: message.role as 'user', content: message.content,
            toolCalls: message.toolCalls, toolCallId: message.toolCallId,
          })),
        ],
      };
    },
  };
}

test('季风准备层先占用执行权，再通过上下文端口装配本轮', async () => {
  const events: string[] = [];
  let runnerOptions: MonsoonTurnSpec | undefined;
  const runtime = runtimePort(runner(), events);
  runtime.prepare = async (_sessionId, options) => {
    events.push('prepare'); runnerOptions = options; return runner();
  };
  const service = new MonsoonChatPreparation('C:/data', runtime, ports(events));
  const result = await service.prepare({
    sessionId: 'session-a', agentId: 'agent-a', model: 'provider:model-b', inputRunId: 'run-a',
    messages: [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'call-a', name: 'read_file', arguments: '{}' }] },
      { role: 'tool', content: 'done', toolCallId: 'call-a' },
    ],
  });

  assert.deepEqual(events, ['agent', 'native', 'prepare', 'context']);
  assert.equal(result.systemPrompt, 'SYSTEM');
  assert.equal(result.effectiveModel, 'provider:model-b');
  assert.equal(result.chatMessages[2]?.toolCalls?.[0]?.id, 'call-a');
  assert.equal(result.chatMessages[3]?.toolCallId, 'call-a');
  assert.equal(runnerOptions?.agentId, 'agent-a');
  assert.equal(runnerOptions?.native, true);
});

test('季风上下文装配失败会释放已占用的运行时', async () => {
  const events: string[] = [];
  const dependencies = ports(events);
  dependencies.compileContext = async () => { events.push('context'); throw new Error('prompt failed'); };
  const service = new MonsoonChatPreparation('C:/data', runtimePort(runner(), events), dependencies);

  await assert.rejects(() => service.prepare({
    sessionId: 'session-a', agentId: 'agent-a', messages: [{ role: 'user', content: 'hello' }],
  }), /prompt failed/);
  assert.deepEqual(events, ['agent', 'native', 'prepare', 'context', 'fail']);
});

test('已占用的季风会话在上下文装配前返回冲突且不清理现有执行', async () => {
  const events: string[] = [];
  const runtime = runtimePort(runner(true), events);
  runtime.prepare = async () => { events.push('prepare'); throw new FrameworkError({
    code: 'MONSOON_SESSION_BUSY', kind: 'conflict', message: '会话正在执行中',
    source: 'monsoon.runtime', retryable: false,
  }); };
  const service = new MonsoonChatPreparation('C:/data', runtime, ports(events));

  await assert.rejects(() => service.prepare({
    sessionId: 'session-a', agentId: 'agent-a', messages: [{ role: 'user', content: 'hello' }],
  }), (error: unknown) => error instanceof FrameworkError
    && error.data.code === 'MONSOON_SESSION_BUSY');
  assert.deepEqual(events, ['agent', 'native', 'prepare']);
});
