export interface TradewindReadPort {
  nodeStatuses(): unknown;
  nodeStatus(nodeId: string): unknown;
  nodeSnapshot(nodeId: string): Promise<unknown>;
  meetingStatus(nodeId: string): unknown;
  agentNodeConversation(input: { workflowId: string; executionId: string;
    nodeId: string; limit: number }): Promise<unknown>;
  agentMeetingConversation(input: { workflowId: string; executionId: string;
    nodeId: string; scope: 'public' | 'chair'; limit: number; round?: number }): Promise<unknown>;
}
