import type { FrameworkErrorKind } from '../../../engine/shared/framework-error.js';
import type { ToolCallRecord } from './convection-react-adapter.js';
import type { TokenUsage } from '../../../engine/shared/llm-bridge.js';

export type ConvectionStreamEvent =
  | import('../../../engine/shared/compaction/contracts.js').CompactionNotice
  | { type: 'input-accepted' }
  | { type: 'agent-start'; agentId: string; label: string }
  | { type: 'token'; agentId: string; label: string; chunk: string }
  | { type: 'reasoning'; agentId: string; label: string; chunk: string }
  | { type: 'tool-call'; agentId: string; label: string; tool: string; args: Record<string, string> }
  | { type: 'tool-result'; agentId: string; label: string; tool: string; result: string; ok?: boolean }
  | { type: 'agent-done'; agentId: string; label: string; content: string; rawContent: string;
      reasoning?: string; toolCalls: ToolCallRecord[] }
  | { type: 'agent-failed'; agentId: string; label: string; message: string;
      code?: string; kind?: FrameworkErrorKind }
  | { type: 'heartbeat'; agentId: string; label: string;
      phase: 'llm-waiting' | 'tool-exec'; elapsed: number }
  | { type: 'chair-token'; chunk: string }
  | { type: 'chair-reasoning'; chunk: string }
  | { type: 'chair-done'; content: string }
  | { type: 'usage'; usage: TokenUsage | null }
  | { type: 'compact-start' }
  | { type: 'compact-done'; archivedCycles: number; summaryLength: number }
  | { type: 'notice'; message: string }
  | { type: 'error'; message: string; code?: string; kind?: FrameworkErrorKind };

export type ConvectionEventSink = (event: ConvectionStreamEvent) => void;
