import type { Envelope, ExecutionContext } from '../foundation/types/index.js';
import type { HandoffSelection } from '../foundation/handoff-target.js';
import { BUILTIN_EVENT_IDS } from '../foundation/types/index.js';
import { markEnvelopePending, markEnvelopeDone } from '../foundation/node-status-store.js';
import { abortableSleep, readDeliveryDelaySec } from './delivery-delay.js';
import type { NodeRunner } from './node-runner.js';

interface Delivery { output: string; autoOutcome?: 'completed' | 'anomaly'; target?: HandoffSelection }

/** 仅 waitForInputs 产生的正式信封拥有交接权；聊天与横向联络不经过这里。 */
export async function runAgentEnvelopeLoop(context: ExecutionContext, runner: NodeRunner): Promise<void> {
  while (!context.signal.aborted) {
    try {
      const envelopes = await context.waitForInputs();
      if (context.signal.aborted || !envelopes.length) return;
      markEnvelopePending(context.executionId, context.nodeId);
      try {
        const result = await processEnvelope(context, runner, envelopes);
        if (context.signal.aborted) return;
        if (result.autoOutcome === 'anomaly') await context.emit(BUILTIN_EVENT_IDS.AUTO_ANOMALY,
          { message: '自动模式：节点未显式调用 complete_task，已强制封口并交接下游' });
        const delaySec = readDeliveryDelaySec(context.nodeConfig);
        if (delaySec > 0) {
          await context.emit(BUILTIN_EVENT_IDS.DELIVERY_DELAY, { seconds: delaySec });
          if (await abortableSleep(delaySec, context.signal) === 'aborted') return;
        }
        await context.sendHandoff(result.output, BUILTIN_EVENT_IDS.HANDOFF, undefined, undefined, result.target);
        await context.emit(BUILTIN_EVENT_IDS.WORK_DONE);
      } finally { markEnvelopeDone(context.executionId, context.nodeId); }
    } catch (error) {
      if ((error as Error).name === 'BufferAbortError') return;
      throw error;
    }
  }
}

function processEnvelope(context: ExecutionContext, runner: NodeRunner, envelopes: Envelope[]): Promise<Delivery> {
  const content = envelopes.length === 1
    ? `[系统信息：工作流上游传来的工作指令]\n\n${envelopes[0].content}`
    : envelopes.map((envelope, index) => `[系统信息：工作流上游传来的工作指令 ${index + 1}/${envelopes.length}]\n${envelope.content}`).join('\n\n');
  return new Promise((resolve, reject) => {
    const aborted = () => resolve({ output: '' });
    context.signal.addEventListener('abort', aborted, { once: true });
    runner.push({ source: 'envelope', content, envelopeId: envelopes[0].envelopeId,
      activationId: envelopes[0].activationId,
      onComplete: (output, info) => { context.signal.removeEventListener('abort', aborted); resolve({ output, ...info }); },
      onFailure: error => { context.signal.removeEventListener('abort', aborted); reject(error); } });
  });
}
