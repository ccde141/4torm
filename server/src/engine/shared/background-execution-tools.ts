import type { ToolDef } from './tool-defs-loader.js';
import type { ObservationScope } from '../../services/execution-observation-contract.js';
import {
  backgroundExecutions,
  formatExecutionSnapshot,
} from '../../services/background-execution.js';

export const BACKGROUND_EXECUTION_TOOL_NAMES = [
  'inspect_execution',
  'wait_execution',
  'terminate_execution',
] as const;

export type BackgroundExecutionToolName = typeof BACKGROUND_EXECUTION_TOOL_NAMES[number];

export function isBackgroundExecutionTool(tool: string): tool is BackgroundExecutionToolName {
  return (BACKGROUND_EXECUTION_TOOL_NAMES as readonly string[]).includes(tool);
}

const BACKGROUND_USAGE_GUIDANCE = [
  '当前入口支持后台执行：若运行超过约 3 秒，工具会返回 executionId，Agent 可立即继续处理其他工作。',
  '收到 executionId 后不要重复启动同一任务；使用 inspect_execution 查看状态、wait_execution 有限等待、terminate_execution 终止。',
].join(' ');

/** 只在真正开放后台生命周期的功能区中改写本轮工具说明。 */
export function withBackgroundExecutionGuidance(toolDefs: ToolDef[]): ToolDef[] {
  return toolDefs.map(tool => tool.executionMode === 'detachable'
    ? { ...tool, description: `${tool.description}\n\n${BACKGROUND_USAGE_GUIDANCE}` }
    : tool);
}

/** 静态工具定义共享；是否开放由各功能区自己的生命周期决定。 */
export function buildBackgroundExecutionToolDefs(): ToolDef[] {
  return [
    {
      name: 'inspect_execution',
      description: '查看一个已启动后台执行的当前状态和最终结果。使用 run_command 返回的 executionId。',
      parameters: {
        type: 'object',
        properties: {
          executionId: { type: 'string', description: '后台执行编号' },
        },
        required: ['executionId'],
      },
    },
    {
      name: 'wait_execution',
      description: '有限等待一个后台执行；最长等待30秒，超时后返回当前状态，不会无限阻塞。',
      parameters: {
        type: 'object',
        properties: {
          executionId: { type: 'string', description: '后台执行编号' },
          timeoutMs: { type: 'string', description: '可选，等待毫秒数，范围0-30000，默认10000' },
        },
        required: ['executionId'],
      },
    },
    {
      name: 'terminate_execution',
      description: '终止一个仍在运行的后台执行。只能终止当前会话或工位自己启动的执行。',
      parameters: {
        type: 'object',
        properties: {
          executionId: { type: 'string', description: '后台执行编号' },
        },
        required: ['executionId'],
      },
    },
  ];
}

export async function executeBackgroundExecutionTool(input: {
  tool: BackgroundExecutionToolName;
  args: Record<string, string>;
  scope: ObservationScope;
  ownerId: string;
}): Promise<string> {
  const executionId = input.args.executionId?.trim();
  if (!executionId) return '操作失败：缺少 executionId。';

  if (input.tool === 'inspect_execution') {
    const snapshot = backgroundExecutions.inspect(executionId, input.scope, input.ownerId);
    return snapshot ? formatExecutionSnapshot(snapshot) : '操作失败：未找到属于当前会话的执行。';
  }

  if (input.tool === 'wait_execution') {
    const parsed = Number.parseInt(input.args.timeoutMs ?? '', 10);
    const timeoutMs = Number.isFinite(parsed) ? Math.max(0, Math.min(30_000, parsed)) : 10_000;
    try {
      return formatExecutionSnapshot(await backgroundExecutions.wait(
        executionId,
        input.scope,
        input.ownerId,
        timeoutMs,
      ));
    } catch {
      return '操作失败：未找到属于当前会话的执行。';
    }
  }

  const terminated = await backgroundExecutions.terminate(executionId, input.scope, input.ownerId);
  if (!terminated) return '操作失败：执行不存在、已结束或不属于当前会话。';
  const snapshot = backgroundExecutions.inspect(executionId, input.scope, input.ownerId);
  return snapshot ? formatExecutionSnapshot(snapshot) : '已提交终止请求。';
}
