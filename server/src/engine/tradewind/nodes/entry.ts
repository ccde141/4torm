/**
 * Entry 节点执行器 —— 工作流入口
 *
 * 行为：
 * - waitForInputs() 立即 resolve（expected=0）
 * - 优先使用配置项 initialEnvelope 作为信封内容
 * - 如无配置，fallback 到 orchestrator 注入的 _initialInput
 * - sendHandoff 把内容投给下游
 *
 * 配置项：
 * - initialEnvelope: string（可选，预设的初始信封内容）
 */

import type {
  NodeExecutor,
  ExecutionContext,
  InputKind,
  OutputKind,
  EventTypeDef,
  JSONSchema,
  NodeSnapshot,
} from '../foundation/types';
import { BUILTIN_EVENT_IDS } from '../foundation/types';

export class EntryExecutor implements NodeExecutor {
  readonly type = 'entry';
  readonly category = 'flow';
  readonly label = '入口';
  readonly inputKinds: InputKind[] = ['none'];
  readonly outputKinds: OutputKind[] = ['handoff'];
  readonly events: EventTypeDef[] = [];

  configSchema(): JSONSchema {
    return {
      type: 'object',
      properties: {
        initialEnvelope: {
          type: 'string',
          description: '初始信封内容（启动时自动注入下游）',
        },
      },
    };
  }

  validateConfig(): boolean {
    return true;
  }

  async execute(ctx: ExecutionContext): Promise<void> {
    ctx.setState('active');
    await ctx.waitForInputs(); // 立即 resolve（expected=0）

    const cfg = ctx.nodeConfig as { initialEnvelope?: string; _initialInput?: string };
    const content = cfg.initialEnvelope?.trim() || cfg._initialInput || '';
    await ctx.sendHandoff(content, BUILTIN_EVENT_IDS.HANDOFF);

    ctx.emit(BUILTIN_EVENT_IDS.WORK_DONE);
    ctx.setState('idle');
  }
}
