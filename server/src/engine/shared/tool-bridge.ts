/**
 * 工具调用转义层（Tool Bridge）—— 共享基础设施
 *
 * 职责（纯函数，无状态，无 IO）：
 * - 把 ToolDef[] 翻译成 provider 的 tools 参数
 * - 把 provider 响应里的 tool_calls 规范化成 NativeToolCall[]
 * - 流式 tool_calls 分片累加器
 *
 * 设计要点：
 * - 按 provider family 分支翻译，对内统一成规范格式
 * - 现在只实现 openai family（含「假 OpenAI」中转，如 One API）
 * - anthropic / gemini 留类型位，不实现（YAGNI）
 *
 * 不含任何引擎协议个性逻辑 → 属共享层，三引擎安全共用。
 */

import type { ToolDef } from './tool-defs-loader';
import type { NativeToolCall } from './types';

export type ProviderFamily = 'openai' | 'anthropic' | 'gemini';

// ── OpenAI tools 参数格式 ──────────────────────────────────────────

interface OpenAIFunctionTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required: string[];
    };
  };
}

/**
 * ToolDef[] → provider 的 tools 参数。
 * openai：标准 function tool 结构，直接复用 ToolDef.parameters（本就是 JSON Schema）。
 */
export function toProviderTools(defs: ToolDef[], family: ProviderFamily): unknown[] {
  if (family !== 'openai') {
    throw new Error(`tool-bridge: family '${family}' 尚未实现（当前仅支持 openai）`);
  }
  return defs.map<OpenAIFunctionTool>(d => ({
    type: 'function',
    function: {
      name: d.name,
      description: d.description ?? '',
      parameters: {
        type: 'object',
        properties: d.parameters?.properties ?? {},
        required: Array.isArray(d.parameters?.required) ? d.parameters!.required : [],
      },
    },
  }));
}

// ── 非流式响应 → 规范化 tool_calls ────────────────────────────────

interface RawOpenAIToolCall {
  id?: string;
  function?: { name?: string; arguments?: string };
}

/**
 * 从非流式 message 对象解析 tool_calls → NativeToolCall[]。
 * 兼容「假 OpenAI」中转（id 可能是 tooluse_xxx 风格，原样保留）。
 * 无 tool_calls 时返回空数组。
 */
export function parseToolCalls(message: unknown, family: ProviderFamily): NativeToolCall[] {
  if (family !== 'openai') {
    throw new Error(`tool-bridge: family '${family}' 尚未实现（当前仅支持 openai）`);
  }
  const raw = (message as { tool_calls?: RawOpenAIToolCall[] })?.tool_calls;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(tc => tc?.function?.name)
    .map((tc, i) => ({
      id: tc.id || `call_${i}`,
      name: tc.function!.name!,
      arguments: tc.function!.arguments ?? '',
    }));
}

// ── 流式 tool_calls 累加器 ────────────────────────────────────────

interface OpenAIToolCallDelta {
  index?: number;
  id?: string;
  function?: { name?: string; arguments?: string };
}

/**
 * 流式 tool_calls 分片累加器。
 *
 * tool_calls 在 SSE delta 里按 index 分片到达：
 * - id / name 通常只在某个 index 的首片出现
 * - arguments 跨多片增量拼接
 * 必须全部收完才能 finish()，中途 JSON.parse 必失败。
 */
export function makeToolCallAccumulator() {
  const acc = new Map<number, { id: string; name: string; args: string }>();

  return {
    /** 喂入一个 delta.tool_calls 数组 */
    push(deltas: OpenAIToolCallDelta[] | undefined): void {
      if (!Array.isArray(deltas)) return;
      for (const d of deltas) {
        const i = d.index ?? 0;
        const cur = acc.get(i) ?? { id: '', name: '', args: '' };
        if (d.id) cur.id = d.id;
        if (d.function?.name) cur.name += d.function.name;
        if (d.function?.arguments) cur.args += d.function.arguments;
        acc.set(i, cur);
      }
    },
    /** 是否累积到任何 tool_call 分片 */
    hasAny(): boolean {
      return acc.size > 0;
    },
    /** 收尾，按 index 升序返回规范化 tool_calls */
    finish(): NativeToolCall[] {
      return [...acc.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([i, v]) => ({
          id: v.id || `call_${i}`,
          name: v.name,
          arguments: v.args,
        }))
        .filter(tc => tc.name);
    },
  };
}
