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
  EnvelopeHeader,
} from '../foundation/types';
import { BUILTIN_EVENT_IDS } from '../foundation/types';
import type { LoopContext } from '../orchestrator/orchestrator';

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

    const cfg = ctx.nodeConfig as {
      initialEnvelope?: string;
      _initialInput?: string;
      _loopContext?: LoopContext;
    };
    const lc = cfg._loopContext;
    const seed = cfg.initialEnvelope?.trim() || '';
    const carried = cfg._initialInput || '';

    // 内容解析：
    // - 循环模式（有 _loopContext）：initialEnvelope 是「每圈稳定种子」（如 topic），
    //   结转输入是「圈间流动部分」（accumulate=上圈产出 / reset=框定语）。二者**合并**注入，
    //   否则 initialEnvelope 一存在就会永远覆盖结转，导致累积/重置机制彻底失效。
    // - 单次运行（无 _loopContext）：保持原「二选一，种子优先」语义，零行为变更。
    const content = lc
      ? [seed, carried].filter(Boolean).join('\n\n')
      : (seed || carried);

    // 循环中的一圈：给出线信封盖信封皮（lap / loopNote / idempotencyKey）
    const header: EnvelopeHeader | undefined = lc
      ? {
          lap: { index: lc.lapIndex, total: lc.lapTotal },
          ...(lc.loopNote ? { loopNote: lc.loopNote } : {}),
          ...(lc.idempotencyKey ? { idempotencyKey: lc.idempotencyKey } : {}),
        }
      : undefined;

    await ctx.sendHandoff(content, BUILTIN_EVENT_IDS.HANDOFF, undefined, header);

    ctx.emit(BUILTIN_EVENT_IDS.WORK_DONE);
    ctx.setState('idle');
  }
}
