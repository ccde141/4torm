import { invokeFeature } from '../../api/collaboration';
import type { WorkflowMode } from '../types';

export interface StartWorkflowInput {
  workflowId: string;
  initialInput?: string;
  mode?: WorkflowMode;
  profileId?: string;
}

export interface StartWorkflowReceipt {
  operationId: string;
  runId: string;
  executionId: string;
}

export function requestStart(input: StartWorkflowInput, fallback = '启动工作流失败') {
  return invokeFeature<StartWorkflowReceipt>('tradewind', 'startWorkflow', input, fallback);
}

export async function requestStop(executionId: string, fallback = '停止工作流失败'): Promise<void> {
  await invokeFeature('tradewind', 'stopWorkflow', { executionId }, fallback);
}

export async function submitHumanGate(
  executionId: string, nodeId: string, content: string, fallback = '提交审查失败',
): Promise<void> {
  await invokeFeature('tradewind', 'submitHumanGate', { executionId, nodeId, content }, fallback);
}

export async function abortNodeRound(
  nodeId: string, runId: string, fallback = '停止节点轮次失败',
): Promise<void> {
  await invokeFeature('tradewind', 'abortNodeRound', { nodeId, runId }, fallback);
}

export async function pauseNodeRound(
  nodeId: string, runId: string, fallback = '暂停节点轮次失败',
): Promise<void> {
  await invokeFeature('tradewind', 'pauseNodeRound', { nodeId, runId }, fallback);
}

export async function resumeNodeRound(
  nodeId: string, executionId: string, fallback = '继续节点轮次失败',
): Promise<void> {
  await invokeFeature('tradewind', 'resumeNodeRound', { nodeId, executionId }, fallback);
}

export async function abortMeetingRound(
  nodeId: string, runId: string, fallback = '停止会议轮次失败',
): Promise<void> {
  await invokeFeature('tradewind', 'abortMeetingRound', { nodeId, runId }, fallback);
}

export async function sendNodeMessage(
  executionId: string, nodeId: string, message: string, fallback = '发送节点消息失败',
): Promise<{ accepted: true; nodeId: string; messageId?: string }> {
  return invokeFeature('tradewind', 'sendNodeMessage', { executionId, nodeId, message }, fallback);
}
