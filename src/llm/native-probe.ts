/**
 * 原生工具调用能力探测
 *
 * 在「模型被加入启用列表」时调用：发一个最小的带 tools 的非流式请求，
 * 看 provider 是否返回 tool_calls，以此判定该 model 支不支持原生 function calling。
 *
 * 关键边界：
 * - 仅当「请求成功且收到明确响应」时才落盘结论（true/false）
 * - 请求报错（网络/key/模型名）→ 抛出，调用方不落盘，避免把配置错误误判为「不支持原生」
 */

import { request, LLMError } from './client';

/** 探测用的最小工具：无参数的 ping */
const PROBE_TOOL = {
  type: 'function',
  function: {
    name: 'ping',
    description: '连通性探测工具，调用它回复 pong',
    parameters: { type: 'object', properties: {}, required: [] },
  },
};

interface ProbeOpts {
  baseUrl: string;
  apiKey?: string;
  headers?: Record<string, string>;
  model: string;
  signal?: AbortSignal;
}

/** 探测结果：reachable=能否连通, native=是否支持原生工具调用 */
export interface ProbeResult {
  reachable: boolean;
  native: boolean;
}

interface ChatResp {
  choices?: Array<{
    message?: {
      tool_calls?: Array<{ id?: string; function?: { name?: string } }>;
    };
  }>;
}

/**
 * 探测单个 model 的原生工具调用能力。
 *
 * @returns reachable=true 时 native 才有意义；reachable=false 表示连通失败（不应落盘）
 */
export async function probeNativeCapability(opts: ProbeOpts): Promise<ProbeResult> {
  const body = {
    model: opts.model,
    messages: [
      { role: 'system', content: '你是一个工具调用测试助手。' },
      { role: 'user', content: '请调用 ping 工具。' },
    ],
    tools: [PROBE_TOOL],
    tool_choice: 'auto',
    max_tokens: 64,
    temperature: 0,
  };

  let resp: ChatResp;
  try {
    resp = await request<ChatResp>('/chat/completions', {
      baseUrl: opts.baseUrl,
      apiKey: opts.apiKey,
      headers: opts.headers,
      signal: opts.signal,
    }, body);
  } catch (e) {
    // 连通失败：网络 / key / 模型名错误 → 不可落盘
    if (e instanceof LLMError) {
      return { reachable: false, native: false };
    }
    // 超时等其它错误同样视为不可达
    return { reachable: false, native: false };
  }

  // 能拿到响应 = 连通 OK。再看有没有 tool_calls。
  const toolCalls = resp.choices?.[0]?.message?.tool_calls;
  const native = Array.isArray(toolCalls) && toolCalls.some(tc => tc.function?.name === 'ping');
  return { reachable: true, native };
}
