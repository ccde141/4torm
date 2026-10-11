import { frameworkError, FrameworkError } from '../../../engine/shared/framework-error.js';
import { activeHumanGates } from '../../../engine/tradewind/nodes/human-gate.js';
import { activeNodeRunners } from '../../../engine/tradewind/nodes/agent.js';
import { activeMeetings } from '../../../engine/tradewind/nodes/meeting.js';
import {
  getActiveTradewindOrchestrator,
  isTradewindExecutionRunning,
  startTradewindExecution,
  stopActiveTradewindExecution,
} from '../../../services/tradewind-execution.js';
import type { TradewindCommands } from '../application/execution-commands.js';
import type { TradewindWorkflowStore } from '../application/workflow-store.js';
import { createTradewindWorkflowStore } from './workflow-store.js';

export function createTradewindCommands(
  dataDir: string,
  store: TradewindWorkflowStore = createTradewindWorkflowStore(dataDir),
): TradewindCommands {
  return {
    start: async (input, actor) => {
      try {
        const definition = await store.read(input.workflowId);
        return await startTradewindExecution({
          dataDir, ...input, graph: definition.graph, workflowName: definition.name,
          trigger: actor.type === 'agent'
            ? { source: 'conversation', agentId: actor.id }
            : { source: 'user' },
        });
      } catch (error) {
        throw mapTradewindStartError(error);
      }
    },
    stop: async input => {
      const active = requireExecution(input.executionId);
      const executionId = active.getExecutionId();
      await stopActiveTradewindExecution();
      return { stopped: true, executionId };
    },
    submitHumanGate: async input => {
      requireExecution(input.executionId);
      const gate = activeHumanGates.get(input.nodeId);
      if (!gate) throw frameworkError({ code: 'TRADEWIND_HUMAN_GATE_NOT_WAITING', kind: 'not_found',
        message: '该节点没有等待中的审查', source: 'tradewind.control', retryable: false });
      const content = input.content?.trim() || gate.envelopeContent;
      gate.resolve({ content });
      return { accepted: true, nodeId: input.nodeId };
    },
    abortNodeRound: async input => {
      const runner = requireNodeRound(input.nodeId, input.runId);
      if (!runner.abortRound(input.runId)) throw invalidNodeAction('只有人类发起的节点会话可以单独停止');
      return { aborted: true, ...input };
    },
    pauseNodeRound: async input => {
      const runner = requireNodeRound(input.nodeId, input.runId);
      if (!runner.pause(input.runId)) throw invalidNodeAction('节点当前没有可暂停的信封轮');
      return { paused: true, ...input };
    },
    resumeNodeRound: async input => {
      requireExecution(input.executionId);
      const runner = activeNodeRunners.get(input.nodeId);
      if (!runner) throw nodeMissing();
      if (!runner.resume()) throw invalidNodeAction('节点当前没有已暂停的信封轮');
      return { resumed: true, nodeId: input.nodeId };
    },
    abortMeetingRound: async input => {
      const meeting = activeMeetings.get(input.nodeId);
      if (!meeting) throw meetingMissing();
      if (!meeting.roundIdentity || meeting.roundIdentity.runId !== input.runId) throw roundChanged();
      if (!meeting.roundAbort || !meeting.session.busy) throw noActiveRound();
      meeting.roundAbort.abort();
      return { aborted: true, ...input };
    },
    sendNodeMessage: async input => {
      requireExecution(input.executionId);
      const runner = activeNodeRunners.get(input.nodeId);
      if (!runner) throw nodeMissing();
      if (runner.isBusy()) throw controlError('TRADEWIND_NODE_BUSY', 'conflict',
        '节点正在处理上一条消息，请稍后再试');
      runner.push({ source: 'human', content: input.message });
      return { accepted: true, nodeId: input.nodeId };
    },
  };
}

function requireExecution(executionId: string) {
  const active = getActiveTradewindOrchestrator();
  if (!isTradewindExecutionRunning() || !active) throw notRunning();
  if (active.getExecutionId() !== executionId) {
    throw controlError('TRADEWIND_EXECUTION_CHANGED', 'conflict', '工作流执行已经变化，请刷新状态后重试');
  }
  return active;
}

function requireNodeRound(nodeId: string, runId: string) {
  const runner = activeNodeRunners.get(nodeId);
  if (!runner) throw nodeMissing();
  if (runner.getRoundIdentity()?.runId !== runId) throw roundChanged();
  return runner;
}

function controlError(code: string, kind: 'not_found' | 'conflict', message: string) {
  return frameworkError({ code, kind, message, source: 'tradewind.control', retryable: false });
}

function nodeMissing() { return controlError('TRADEWIND_NODE_NOT_ACTIVE', 'not_found', '节点尚未激活'); }
function meetingMissing() { return controlError('TRADEWIND_MEETING_NOT_ACTIVE', 'not_found', '会议尚未激活'); }
function roundChanged() { return controlError('TRADEWIND_ROUND_CHANGED', 'conflict', '轮次已经变化，请刷新状态后重试'); }
function noActiveRound() { return controlError('TRADEWIND_ROUND_NOT_ACTIVE', 'conflict', '当前没有可中止的轮次'); }
function invalidNodeAction(message: string) {
  return controlError('TRADEWIND_NODE_ACTION_INVALID', 'conflict', message);
}

export function mapTradewindStartError(error: unknown) {
  if (error instanceof FrameworkError) return error;
  const cause = error as Error & { validationErrors?: unknown };
  if (cause.validationErrors) return frameworkError({ code: 'TRADEWIND_GRAPH_INVALID', kind: 'validation',
    message: validationMessage(cause.message, cause.validationErrors),
    source: 'tradewind.control', retryable: false,
    details: { errors: cause.validationErrors },
  }, { cause });
  if (cause.message.includes('正在运行')) return frameworkError({
    code: 'TRADEWIND_EXECUTION_BUSY', kind: 'conflict', message: cause.message,
    source: 'tradewind.control', retryable: false,
  }, { cause });
  if (cause.message.startsWith('档案不存在')) return frameworkError({
    code: 'TRADEWIND_PROFILE_NOT_FOUND', kind: 'not_found', message: cause.message,
    source: 'tradewind.control', retryable: false,
  }, { cause });
  return frameworkError({ code: 'TRADEWIND_START_FAILED', kind: 'internal',
    message: '信风工作流启动失败', source: 'tradewind.control', retryable: false,
  }, { cause });
}

function validationMessage(summary: string, value: unknown): string {
  if (!Array.isArray(value)) return summary;
  const messages = value.slice(0, 10).flatMap(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const message = (item as { message?: unknown }).message;
    return typeof message === 'string' && message.trim() ? [message.trim().slice(0, 500)] : [];
  });
  return messages.length > 0 ? `${summary}：\n\n${messages.map(message => `· ${message}`).join('\n')}` : summary;
}

function notRunning() {
  return frameworkError({ code: 'TRADEWIND_EXECUTION_NOT_RUNNING', kind: 'not_found',
    message: '当前没有运行中的信风工作流', source: 'tradewind.control', retryable: false });
}
