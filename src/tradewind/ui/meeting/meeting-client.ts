/**
 * 信风 Meeting 节点 HTTP 客户端
 *
 * 从 src/convection/ui/pages/ConvectionPage.tsx 复制解耦，独立演进。
 * 封装 meeting 端点的 HTTP 调用。
 *
 * 信风独立副本，可自主演进。
 */

export type ToolStepStatus = 'running' | 'done' | 'error';

export interface ToolStep {
  tool: string;
  args: Record<string, string>;
  result?: string;
  status?: ToolStepStatus;
}

export interface MeetingMessage {
  speaker: string;
  content: string;
  timestamp: number;
  rawContent?: string;
  toolCalls?: ToolStep[];
  streaming?: boolean;
}

export interface MeetingParticipant {
  nodeId: string;
  agentId: string;
  label: string;
}

export interface MeetingStatus {
  nodeId: string;
  round: number;
  busy: boolean;
  /** 'opening' = 入会摘要中，禁用人类交互；'discussion' = 讨论阶段 */
  phase?: 'opening' | 'discussion';
  messageCount: number;
  participants: MeetingParticipant[];
  configuredParticipants: MeetingParticipant[];
  chairAgentId: string;
  publicMessages?: MeetingMessage[];
  chairMessages?: Array<{ role: string; content: string }>;
  /** 正在流式产出的消息（面板关了再开时 replay 用） */
  streamingCurrent?: { speaker: string; content: string } | null;
}

/** 人类发言 → SSE 流式接收参与 Agent 响应 */
export async function speakStream(
  nodeId: string,
  message: string,
  onEvent: (ev: MeetingSpeakEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`/api/tradewind/meeting/${nodeId}/speak`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `HTTP ${res.status}`);
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const json = line.slice(6).trim();
      if (!json) continue;
      try {
        const ev = JSON.parse(json) as MeetingSpeakEvent;
        onEvent(ev);
      } catch { /* skip */ }
    }
  }
}

export type MeetingSpeakEvent =
  | { type: 'agent-start'; label: string }
  | { type: 'token'; label: string; chunk: string }
  | { type: 'tool-call'; label: string; tool: string; args: Record<string, string> }
  | { type: 'tool-result'; label: string; tool: string; result: string }
  | { type: 'heartbeat'; label: string; phase: string; elapsed: number }
  | { type: 'agent-done'; label: string; content: string; rawContent?: string; toolCalls?: ToolStep[] }
  | { type: 'round-done'; messages: MeetingMessage[] }
  | { type: 'error'; message: string };

/** 人类给会长发消息（SSE 流式） */
export async function chairStream(
  nodeId: string,
  message: string,
  onEvent: (ev: ChairStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`/api/tradewind/meeting/${nodeId}/chair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `HTTP ${res.status}`);
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const json = line.slice(6).trim();
      if (!json) continue;
      try {
        const ev = JSON.parse(json) as ChairStreamEvent;
        onEvent(ev);
      } catch { /* skip */ }
    }
  }
}

export type ChairStreamEvent =
  | { type: 'chair-token'; chunk: string }
  | { type: 'chair-done'; content: string }
  | { type: 'done'; messages: Array<{ role: string; content: string }> }
  | { type: 'error'; message: string };

/** 人类结束会议 → 会长生成纪要 */
export async function endMeeting(nodeId: string): Promise<{ minutes: string }> {
  const res = await fetch(`/api/tradewind/meeting/${nodeId}/end`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

/** 获取会议状态 */
export async function getStatus(nodeId: string): Promise<MeetingStatus> {
  const res = await fetch(`/api/tradewind/meeting/${nodeId}/status`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

/** 动态加入参与者（按节点 ID） */
export async function joinMeeting(nodeId: string, participantNodeId: string): Promise<{ participants: MeetingParticipant[] }> {
  const res = await fetch(`/api/tradewind/meeting/${nodeId}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ participantNodeId }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

/** 动态移除参与者（按节点 ID） */
export async function leaveMeeting(nodeId: string, participantNodeId: string): Promise<{ participants: MeetingParticipant[] }> {
  const res = await fetch(`/api/tradewind/meeting/${nodeId}/leave`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ participantNodeId }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

/** 调整参与者顺序（按节点 ID 数组） */
export async function reorderMeeting(nodeId: string, order: string[]): Promise<{ participants: MeetingParticipant[] }> {
  const res = await fetch(`/api/tradewind/meeting/${nodeId}/reorder`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ order }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
