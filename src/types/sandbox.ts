import type React from 'react';

export interface EnvelopeMeta {
  flowId: string;
  nodeId: string;
  forkIndex: number | null;
  iteration: number | null;
}

export interface Envelope {
  meta: EnvelopeMeta;
  goal: string;
  role: string;
  context: string;
  input: string;
  variables: Record<string, unknown>;
  requirement: string;
  outputSchema: Record<string, unknown> | null;
  reminder: string;
}

export interface ArrowConfig {
  extractField: string | null;
  contextMode: boolean;
  injectRole: boolean;
}

export type SandboxNodeType =
  | 'entry'
  | 'agent'
  | 'condition'
  | 'loop-while'
  | 'merge'
  | 'fork'
  | 'variable'
  | 'human-gate'
  | 'error-handler'
  | 'output'
  | 'group'
  | 'note';

export type NodeExecStatus = 'idle' | 'running' | 'done' | 'error';
export type FlowExecStatus = 'idle' | 'running' | 'paused' | 'finished' | 'error';

export interface EntryNodeData {
  label: string;
  inputContent: string;
  execStatus: NodeExecStatus;
  errorMessage?: string;
}

export interface AgentNodeData {
  label: string;
  agentId: string;
  agentName: string;
  agentRole: string;
  outputSchema: Record<string, unknown> | null;
  inputPorts: Port[];
  workspacePath: string;
  execStatus: NodeExecStatus;
  errorMessage?: string;
}

export interface Port {
  id: string;
  label: string;
}

export interface ConditionNodeData {
  label: string;
  rules: ConditionRule[];
  execStatus: NodeExecStatus;
  errorMessage?: string;
}

export interface ConditionRule {
  field: string;
  operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'regex' | 'expr';
  value: string;
}

export interface LoopNodeData {
  label: string;
  loopType: 'count' | 'while';
  count: number;
  conditionField: string;
  conditionOperator: string;
  conditionValue: string;
  maxIterations: number;
  execStatus: NodeExecStatus;
  errorMessage?: string;
}

export interface MergeNodeData {
  label: string;
  strategy: 'concat' | 'structured' | 'agent-summary';
  summaryAgentId?: string;
  execStatus: NodeExecStatus;
  errorMessage?: string;
}

export interface ForkNodeData {
  label: string;
  branchCount: number;
  execStatus: NodeExecStatus;
  errorMessage?: string;
}

export interface VariableNodeData {
  label: string;
  mode: 'read' | 'write';
  variableName: string;
  sourceField: string;
  execStatus: NodeExecStatus;
  errorMessage?: string;
}

export interface HumanGateNodeData {
  label: string;
  prompt: string;
  execStatus: NodeExecStatus;
  errorMessage?: string;
}

export interface ErrorHandlerNodeData {
  label: string;
  execStatus: NodeExecStatus;
  errorMessage?: string;
}

export interface OutputNodeData {
  label: string;
  mode: 'snapshot' | 'final';
  filePath: string;
  fileNameTemplate: string;
  format: 'json' | 'xml' | 'txt';
  execStatus: NodeExecStatus;
  errorMessage?: string;
}

export interface GroupNodeData {
  label: string;
}

export interface NoteNodeData {
  label: string;
  content: string;
}

export type SandboxNodeData =
  | EntryNodeData
  | AgentNodeData
  | ConditionNodeData
  | LoopNodeData
  | MergeNodeData
  | ForkNodeData
  | VariableNodeData
  | HumanGateNodeData
  | ErrorHandlerNodeData
  | OutputNodeData
  | GroupNodeData
  | NoteNodeData;

export interface SandboxNode {
  id: string;
  type: SandboxNodeType;
  position: { x: number; y: number };
  data: SandboxNodeData;
  style?: React.CSSProperties;
}

export interface SandboxEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  arrowConfig?: ArrowConfig;
}

export interface SandboxWorkflow {
  id: string;
  name: string;
  description: string;
  nodes: SandboxNode[];
  edges: SandboxEdge[];
  activeAgentIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ExecutionLog {
  timestamp: string;
  nodeId: string;
  nodeName: string;
  level: 'info' | 'warn' | 'error';
  message: string;
}

export interface ExecutionState {
  status: FlowExecStatus;
  currentNodeId: string | null;
  envelopes: Record<string, Envelope>;
  logs: ExecutionLog[];
  variables: Record<string, unknown>;
}

export interface HumanGateRequest {
  flowId: string;
  nodeId: string;
  nodeName: string;
  envelope: Envelope;
  prompt: string;
}
