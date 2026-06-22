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
 *
 * 工具名净化：OpenAI 要求 function.name 匹配 ^[a-zA-Z0-9_-]+$，而 MCP 工具名形如
 * `mcp:server:tool`（含冒号，server/tool 还可能含中文/点号）必违规。这里把非法字符
 * 净化成合法名，并返回 sanitized→original 映射；模型回传后用 restoreToolName 反解，
 * 保证 react-loop 拿到的仍是原始名、tools.call 查找不受影响。映射生命周期 = 单次请求。
 */
export interface ProviderToolsResult {
  tools: unknown[];
  /** sanitized name → original name（仅含被改名的项；未改名的无需入表） */
  nameMap: Map<string, string>;
}

/** 把工具名净化成 OpenAI 合法形式（^[a-zA-Z0-9_-]+$），在 used 集合内保证唯一。 */
function sanitizeToolName(name: string, used: Set<string>): string {
  // 非法字符（含冒号、点号、中文、空格等）→ 下划线
  let s = name.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  if (!s) s = 'tool';
  // 撞名时加数字后缀，保证可逆映射一一对应
  let candidate = s;
  let i = 1;
  while (used.has(candidate)) { candidate = `${s}_${i++}`; }
  used.add(candidate);
  return candidate;
}

export function toProviderTools(defs: ToolDef[], family: ProviderFamily): unknown[] {
  return toProviderToolsWithMap(defs, family).tools;
}

/** 同 toProviderTools，但额外返回名字映射（含净化）。供需要回填反解的调用方使用。 */
export function toProviderToolsWithMap(defs: ToolDef[], family: ProviderFamily): ProviderToolsResult {
  if (family !== 'openai') {
    throw new Error(`tool-bridge: family '${family}' 尚未实现（当前仅支持 openai）`);
  }
  const used = new Set<string>();
  const nameMap = new Map<string, string>();
  const tools = defs.map<OpenAIFunctionTool>(d => {
    const legal = /^[a-zA-Z0-9_-]+$/.test(d.name);
    const safeName = legal ? d.name : sanitizeToolName(d.name, used);
    if (legal) used.add(d.name);
    if (safeName !== d.name) nameMap.set(safeName, d.name);
    return {
      type: 'function',
      function: {
        name: safeName,
        description: d.description ?? '',
        parameters: {
          type: 'object',
          properties: d.parameters?.properties ?? {},
          required: Array.isArray(d.parameters?.required) ? d.parameters!.required : [],
        },
      },
    };
  });
  return { tools, nameMap };
}

/** 用映射把模型回传的（可能被净化的）工具名反解回原始名；未命中则原样返回。 */
export function restoreToolName(name: string, nameMap: Map<string, string>): string {
  return nameMap.get(name) ?? name;
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
