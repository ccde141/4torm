export interface TradewindStartCommand {
  workflowId: string;
  initialInput?: string;
  mode?: 'manual' | 'auto';
  profileId?: string;
}

export interface TradewindCommandActor {
  type: 'human' | 'agent';
  id: string;
  sessionId?: string;
}

export interface TradewindStartReceipt {
  workflowId: string;
  workflowName: string;
  executionId: string;
  status: 'running';
  runDir?: string;
  loop?: true;
}

export interface TradewindCommands {
  start(input: TradewindStartCommand, actor: TradewindCommandActor): Promise<TradewindStartReceipt>;
  stop(input: ExecutionCommand): Promise<{ stopped: true; executionId: string }>;
  submitHumanGate(input: ExecutionCommand & { nodeId: string; content?: string }): Promise<{
    accepted: true;
    nodeId: string;
  }>;
  abortNodeRound(input: RoundCommand): Promise<RoundReceipt<'aborted'>>;
  pauseNodeRound(input: RoundCommand): Promise<RoundReceipt<'paused'>>;
  resumeNodeRound(input: ExecutionCommand & { nodeId: string; runId?: string }): Promise<{ resumed: true; nodeId: string }>;
  abortMeetingRound(input: RoundCommand): Promise<RoundReceipt<'aborted'>>;
  sendNodeMessage(input: ExecutionCommand & { nodeId: string; message: string },
    actor?: { type: 'human' | 'agent' | 'system'; id?: string }): Promise<{
    accepted: true;
    nodeId: string;
    messageId?: string;
  }>;
}

export interface RoundCommand { executionId?: string; nodeId: string; runId: string }
export interface ExecutionCommand { executionId: string }
type RoundReceipt<K extends 'aborted' | 'paused'> = { nodeId: string; runId: string } & Record<K, true>;
