import type { NodeExecutor, ExecutionContext } from '../foundation/types/index.js';
import type { HandoffRuntime } from './handoff-runtime.js';

/** 出口逐封记账，只有所有入口 root 都已交付才结束整次运行。 */
export class HandoffOutputExecutor implements NodeExecutor {
  readonly type = 'output'; readonly category = 'flow'; readonly label = '出口';
  readonly inputKinds = ['work'] as NodeExecutor['inputKinds'];
  readonly outputKinds = ['none'] as NodeExecutor['outputKinds'];
  readonly events = [];
  constructor(private readonly runtime: HandoffRuntime) {}
  configSchema() { return { type: 'object', properties: {} }; }
  validateConfig() { return true; }
  async execute(context: ExecutionContext): Promise<void> {
    while (!context.signal.aborted) {
      const [envelope] = await context.waitForInputs();
      if (!envelope || context.signal.aborted) return;
      if (await this.runtime.finishOutput(context.nodeId, envelope)) return;
    }
  }
}
