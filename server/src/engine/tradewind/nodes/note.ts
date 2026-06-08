/**
 * Note 节点执行器 —— 编译期静态文本容器
 *
 * Note 节点不参与运行时执行。它的 config.content 在 Agent 节点
 * 激活时通过 note 边读取，注入到 Agent 的 system prompt 里。
 *
 * execute() 是空操作——orchestrator 激活它后立即完成，
 * 不 sendHandoff，不影响任何下游。
 *
 * 配置项（config）：
 *   content: string — 行为约束文本
 */

import type {
  NodeExecutor,
  ExecutionContext,
  InputKind,
  OutputKind,
  EventTypeDef,
  JSONSchema,
} from '../foundation/types';

export class NoteExecutor implements NodeExecutor {
  readonly type = 'note';
  readonly category = 'flow';
  readonly label = 'Note';
  readonly inputKinds: InputKind[] = ['none'];
  readonly outputKinds: OutputKind[] = ['note'];
  readonly events: EventTypeDef[] = [];

  configSchema(): JSONSchema {
    return {
      type: 'object',
      properties: {
        content: { type: 'string', description: '行为约束文本' },
      },
      required: ['content'],
    };
  }

  validateConfig(config: unknown): boolean {
    return typeof (config as any)?.content === 'string';
  }

  async execute(ctx: ExecutionContext): Promise<void> {
    // Note 节点不执行任何逻辑，立即完成
    ctx.setState('active');
    ctx.setState('idle');
  }
}
