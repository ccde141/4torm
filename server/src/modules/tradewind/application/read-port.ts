export interface TradewindReadIdentity { executionId?: string; workflowId?: string }
export interface TradewindReadPort {
  nodeStatuses(identity?: TradewindReadIdentity): unknown;
  nodeStatus(nodeId: string, identity?: TradewindReadIdentity): unknown;
  nodeSnapshot(nodeId: string, identity?: TradewindReadIdentity): Promise<unknown>;
  meetingStatus(nodeId: string, identity?: TradewindReadIdentity): unknown;
  agentNodeConversation(input: { workflowId: string; executionId: string;
    nodeId: string; limit: number }): Promise<unknown>;
  agentMeetingConversation(input: { workflowId: string; executionId: string;
    nodeId: string; scope: 'public' | 'chair'; limit: number; round?: number }): Promise<unknown>;
}
