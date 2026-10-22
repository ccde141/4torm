import type { ModuleMethodHandler, ModuleMethodManifest } from '../../../engine/collaboration/contracts.js';
import { frameworkError } from '../../../engine/shared/framework-error.js';
import type { RunArchiveInput, RunEventInput, RunEventsInput, RunIdentity, RunListInput,
  TradewindHistoryPort } from '../application/history-port.js';
import { agentOutputPage, parseTextPageInput, type TextPageInput } from './agent-output-page.js';

const identityProperties = { workflowId: { type: 'string', minLength: 1, maxLength: 160 },
  executionId: { type: 'string', minLength: 1, maxLength: 160 } };

export function tradewindHistoryManifests(): ModuleMethodManifest[] {
  return [
    method('listWorkflowRuns', ['workflowId'], { workflowId: identityProperties.workflowId,
      cursor: { type: 'string', maxLength: 1024 }, limit: { type: 'integer', minimum: 1, maximum: 50 } }),
    method('readWorkflowRun', ['workflowId', 'executionId'], { ...identityProperties,
      revision: { type: 'string', pattern: '^[a-f0-9]{64}$' },
      offset: { type: 'integer', minimum: 0 }, maxChars: { type: 'integer', minimum: 1, maximum: 16_384 } }),
    method('readWorkflowRunEvents', ['workflowId', 'executionId'], { ...identityProperties,
      cursor: { type: 'string', maxLength: 1024 }, limit: { type: 'integer', minimum: 1, maximum: 100 },
      eventType: { type: 'string', minLength: 1, maxLength: 160 }, since: { type: 'string' }, until: { type: 'string' } }),
    method('readWorkflowRunEvent', ['workflowId', 'executionId', 'eventOffset'], { ...identityProperties,
      eventOffset: { type: 'integer', minimum: 0 }, offset: { type: 'integer', minimum: 0 },
      maxChars: { type: 'integer', minimum: 1, maximum: 16_384 } }),
    method('readWorkflowRunArchive', ['workflowId', 'executionId', 'kind'], { ...identityProperties,
      revision: { type: 'string', pattern: '^[a-f0-9]{64}$' },
      kind: { type: 'string', enum: ['output', 'node-context', 'meeting'] },
      nodeId: { type: 'string', minLength: 1, maxLength: 1000 }, round: { type: 'integer', minimum: 0 },
      offset: { type: 'integer', minimum: 0 }, maxChars: { type: 'integer', minimum: 1, maximum: 16_384 } }),
  ];
}

export function tradewindHistoryHandlers(port: TradewindHistoryPort): Record<string, ModuleMethodHandler> {
  return {
    listWorkflowRuns: { parse: parseList, invoke: (context, input) => {
      const value = input as RunListInput;
      return port.list(context.audience === 'agent' ? { ...value, limit: Math.min(value.limit, 10) } : value);
    } },
    readWorkflowRun: { parse: parseRun, invoke: async (context, input) => {
      const value = input as RunIdentity & TextPageInput;
      const run = await port.read(value);
      return context.audience === 'agent'
        ? { workflowId: run.workflowId, executionId: run.executionId, status: run.status,
          ...agentOutputPage(run, value, context.budget) } : run;
    } },
    readWorkflowRunEvents: { parse: parseEvents, invoke: (context, input) => {
      const value = input as RunEventsInput;
      return port.events(context.audience === 'agent' ? { ...value, limit: Math.min(value.limit, 10) } : value);
    } },
    readWorkflowRunEvent: { parse: parseEvent, invoke: (_context, input) => port.event(input as RunEventInput) },
    readWorkflowRunArchive: { parse: parseArchive, invoke: (context, input) => {
      const value = input as RunArchiveInput;
      if (context.audience === 'agent' && value.offset > 0 && !value.revision) throw invalid();
      return port.archive(context.audience === 'agent' ? { ...value,
        maxChars: Math.min(value.maxChars, context.budget.textChars ?? 8_000) } : value);
    } },
  };
}

function parseList(value: unknown): RunListInput {
  const item = exact(value, ['workflowId', 'cursor', 'limit']);
  return { workflowId: id(item.workflowId), limit: integer(item.limit, 20, 50), ...cursor(item.cursor) };
}

function parseRun(value: unknown): RunIdentity & TextPageInput {
  const item = exact(value, ['workflowId', 'executionId', 'offset', 'maxChars', 'revision']);
  return { workflowId: id(item.workflowId), executionId: id(item.executionId), ...parseTextPageInput(item) };
}

function parseEvents(value: unknown): RunEventsInput {
  const item = exact(value, ['workflowId', 'executionId', 'cursor', 'limit', 'eventType', 'since', 'until']);
  const since = time(item.since);
  const until = time(item.until);
  if (since && until && Date.parse(since) > Date.parse(until)) throw invalid();
  if (item.eventType !== undefined && (typeof item.eventType !== 'string'
    || !item.eventType.trim() || item.eventType.length > 160)) throw invalid();
  return { workflowId: id(item.workflowId), executionId: id(item.executionId),
    limit: integer(item.limit, 30, 100), ...cursor(item.cursor),
    ...(since ? { since } : {}), ...(until ? { until } : {}),
    ...(item.eventType ? { eventType: String(item.eventType) } : {}) };
}

function parseEvent(value: unknown): RunEventInput {
  const item = exact(value, ['workflowId', 'executionId', 'eventOffset', 'offset', 'maxChars']);
  return { workflowId: id(item.workflowId), executionId: id(item.executionId),
    eventOffset: integer(item.eventOffset, -1, Number.MAX_SAFE_INTEGER, 0),
    offset: integer(item.offset, 0, Number.MAX_SAFE_INTEGER, 0), maxChars: integer(item.maxChars, 16_384, 16_384) };
}

function parseArchive(value: unknown): RunArchiveInput {
  const item = exact(value, ['workflowId', 'executionId', 'kind', 'nodeId', 'round', 'offset', 'maxChars', 'revision']);
  const page = parseTextPageInput(item);
  if (!['output', 'node-context', 'meeting'].includes(String(item.kind))) throw invalid();
  const kind = item.kind as RunArchiveInput['kind'];
  if (kind === 'output' ? item.nodeId !== undefined || item.round !== undefined
    : typeof item.nodeId !== 'string' || !item.nodeId || item.nodeId.length > 1000) throw invalid();
  if (kind === 'node-context' && item.round !== undefined) throw invalid();
  const round = kind === 'meeting' ? integer(item.round, -1, Number.MAX_SAFE_INTEGER, 0) : undefined;
  return { workflowId: id(item.workflowId), executionId: id(item.executionId), kind,
    ...(typeof item.nodeId === 'string' ? { nodeId: item.nodeId } : {}), ...(round === undefined ? {} : { round }),
    ...(page.revision === undefined ? {} : { revision: page.revision }),
    offset: integer(item.offset, 0, Number.MAX_SAFE_INTEGER, 0), maxChars: integer(item.maxChars, 16_384, 16_384) };
}

function exact(value: unknown, allowed: string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !allowed.includes(key))) throw invalid();
  return value as Record<string, unknown>;
}
function id(value: unknown) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}$/.test(value)) throw invalid();
  return value;
}
function time(value: unknown) {
  if (value === undefined) return;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw invalid();
  return value;
}
function cursor(value: unknown) {
  if (value === undefined) return {};
  if (typeof value !== 'string' || !value || value.length > 1024) throw invalid();
  return { cursor: value };
}
function integer(value: unknown, fallback: number, max: number, min = 1) {
  const result = value === undefined ? fallback : value;
  if (!Number.isSafeInteger(result) || Number(result) < min || Number(result) > max) throw invalid();
  return Number(result);
}
function invalid() {
  return frameworkError({ code: 'TRADEWIND_HISTORY_INPUT_INVALID', kind: 'validation',
    message: '信风运行记录查询参数无效', source: 'tradewind.history', retryable: false });
}
function method(id: string, required: string[], properties: Record<string, unknown>): ModuleMethodManifest {
  const tools: Record<string, { name: string; description: string }> = {
    listWorkflowRuns: { name: 'list_workflow_runs',
      description: '按工作流分页列出历次运行、真实终态及执行 ID；用 nextCursor 继续读取。' },
    readWorkflowRun: { name: 'read_workflow_run',
      description: '分段读取某次运行的图快照、状态与归档清单，正文在 text 中；续读携带 revision 与 nextOffset，版本变化时从 0 重新读取。按 archives 的 kind/nodeId/round 读取对应归档。' },
    readWorkflowRunEvents: { name: 'read_workflow_run_events',
      description: '按执行身份分页查询运行事件与信封交接摘要，可按事件类型和时间过滤；保留 nextCursor 翻页。' },
    readWorkflowRunArchive: { name: 'read_workflow_run_archive',
      description: '分段读取某次运行的出口结果、节点公开会话或会议归档；续读携带 revision 与 nextOffset，内容变化时从 0 重新读取。不读取系统提示词和内部思考。' },
  };
  const agentTool = tools[id];
  return { id, kind: 'query', permission: 'observe',
    audiences: agentTool ? ['human', 'agent', 'internal'] : ['human', 'internal'],
    ...(agentTool ? { agentTool } : {}),
    inputSchema: { type: 'object', additionalProperties: false, required, properties },
    output: { mode: 'inline', ...(agentTool ? { budget: {
      textChars: { default: 12_000, max: 20_000 }, textLines: { default: 200, max: 400 },
    } } : {}) } };
}
