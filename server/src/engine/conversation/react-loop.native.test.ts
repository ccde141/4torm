/**
 * runReActLoopNative 显式终结门（completion）单测 —— 用 tsx 跑：
 *   cd server && npx tsx src/engine/conversation/react-loop.native.test.ts
 *
 * 用脚本化的假 LLM + 假 ToolCaller 驱动循环，验证四种行为：
 *   1) 调用终结工具 → autoOutcome='completed'，content=终结工具结果
 *   2) 无 tool_call（想用文本收尾）→ 注入"继续"，之后调终结工具才收口
 *   3) 兜底耗尽仍未终结 → autoOutcome='anomaly'
 *   4) 不传 completion → 行为完全不变（文本即交付、无 autoOutcome）
 */

import assert from 'node:assert/strict';
import { runReActLoopNative, MAX_NUDGES, type LLMCaller, type ToolCaller } from './react-loop';
import type { NativeToolCall, ContextMessage } from '../shared/types';

interface Step { content?: string; toolCalls?: NativeToolCall[]; finishReason?: 'stop' | 'length' | 'tool_calls' | null }

function fakeLLM(script: Step[]): { llm: LLMCaller; calls: () => number } {
  let i = 0;
  const llm: LLMCaller = {
    async call() {
      const step = script[Math.min(i, script.length - 1)];
      i++;
      const finishReason = step.finishReason
        ?? (step.toolCalls && step.toolCalls.length ? 'tool_calls' : 'stop');
      return { content: step.content ?? '', finishReason, toolCalls: step.toolCalls };
    },
  };
  return { llm, calls: () => i };
}

const tools: ToolCaller = {
  async call(tool) {
    if (tool === 'complete_task') return 'SEALED-CONTENT';
    return `${tool}-ok`;
  },
};

const tc = (name: string, args = '{}'): NativeToolCall => ({ id: `${name}-1`, name, arguments: args } as NativeToolCall);

async function run(name: string, fn: () => Promise<void>) {
  await fn();
  console.log(`  ✓ ${name}`);
}

async function main() {
  console.log('runReActLoopNative · completion 终结门');

  await run('调用终结工具 → completed，content=终结工具结果', async () => {
    const { llm } = fakeLLM([
      { toolCalls: [tc('envelope_add', '{"text":"x"}')] },
      { toolCalls: [tc('complete_task', '{"note":"done"}')] },
    ]);
    const r = await runReActLoopNative({
      messages: [{ role: 'system', content: 's' }], llm, tools, toolDefs: [],
      completion: { tool: 'complete_task' },
    });
    assert.equal(r.autoOutcome, 'completed');
    assert.equal(r.content, 'SEALED-CONTENT');
  });

  await run('无 tool_call → 注入继续，之后终结工具收口', async () => {
    const msgs: ContextMessage[] = [{ role: 'system', content: 's' }];
    const { llm, calls } = fakeLLM([
      { content: '我觉得做完了', finishReason: 'stop' }, // 文本收尾——应被拒，注入继续
      { toolCalls: [tc('complete_task')] },
    ]);
    const r = await runReActLoopNative({ messages: msgs, llm, tools, toolDefs: [], completion: { tool: 'complete_task' } });
    assert.equal(r.autoOutcome, 'completed');
    assert.equal(r.content, 'SEALED-CONTENT');
    assert.equal(calls(), 2); // 恰好两轮
    // 注入的"继续"提示应点名终结工具
    assert.ok(msgs.some(m => m.role === 'user' && m.content.includes('complete_task')));
  });

  await run('耗尽→强制总结→仍不封口→系统兜底封口：anomaly 但照样交接下游', async () => {
    const msgs: ContextMessage[] = [{ role: 'system', content: 's' }];
    const { llm, calls } = fakeLLM([{ content: '还在想…', finishReason: 'stop' }]); // 永远文本收尾
    const r = await runReActLoopNative({ messages: msgs, llm, tools, toolDefs: [], completion: { tool: 'complete_task' } });
    assert.equal(r.autoOutcome, 'anomaly');
    assert.equal(r.content, 'SEALED-CONTENT'); // 系统替它调终结工具封口的结果——不是诊断串，照传下游
    assert.equal(calls(), MAX_NUDGES + 2); // 10 温和提示 + 1 强制总结 + 1 兜底封口
    assert.ok(msgs.some(m => m.role === 'user' && m.content.includes('强制指令')), '应注入强制总结指令');
  });

  await run('强制总结那轮模型终于封口 → 仍标 anomaly，内容来自其封口', async () => {
    const script: Step[] = [];
    for (let i = 0; i < MAX_NUDGES + 1; i++) script.push({ content: '还在想…', finishReason: 'stop' });
    script.push({ toolCalls: [tc('complete_task')] }); // 强制总结后终于调用
    const { llm } = fakeLLM(script);
    const r = await runReActLoopNative({ messages: [{ role: 'system', content: 's' }], llm, tools, toolDefs: [], completion: { tool: 'complete_task' } });
    assert.equal(r.autoOutcome, 'anomaly'); // 被逼出来的封口仍算异常
    assert.equal(r.content, 'SEALED-CONTENT');
  });

  await run('被截断的 tool_call（length）→ 丢弃不执行、提示重发，不 parse 残缺参数', async () => {
    const msgs: ContextMessage[] = [{ role: 'system', content: 's' }]
    const seen: string[] = []
    const trackTools: ToolCaller = {
      async call(tool) { seen.push(tool); return tool === 'complete_task' ? 'SEALED-CONTENT' : `${tool}-ok` },
    }
    const { llm } = fakeLLM([
      { toolCalls: [tc('write_file', '{"path":"a.md","content":"被截断的半段')], finishReason: 'length' }, // 残缺 JSON
      { toolCalls: [tc('complete_task')] },
    ])
    const r = await runReActLoopNative({ messages: msgs, llm, tools: trackTools, toolDefs: [], completion: { tool: 'complete_task' } })
    assert.equal(r.autoOutcome, 'completed')
    assert.equal(r.content, 'SEALED-CONTENT')
    assert.ok(!seen.includes('write_file'), '被截断的 write_file 不该被执行')
    assert.ok(msgs.some(m => m.role === 'user' && m.content.includes('被截断')), '应注入重发提示')
  })

  await run('不传 completion → 行为不变（文本即交付、无 autoOutcome）', async () => {
    const { llm, calls } = fakeLLM([{ content: '最终答案', finishReason: 'stop' }]);
    const r = await runReActLoopNative({ messages: [{ role: 'system', content: 's' }], llm, tools, toolDefs: [] });
    assert.equal(r.autoOutcome, undefined);
    assert.equal(r.content, '最终答案');
    assert.equal(calls(), 1); // 一轮就交付，绝不多问
  });

  console.log('ok');
}

main().catch((e) => { console.error(e); process.exit(1); });
