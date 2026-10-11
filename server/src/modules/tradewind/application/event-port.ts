export interface PreparedTradewindEventStream {
  snapshots(): Record<string, unknown>[];
  subscribe(listener: (event: Record<string, unknown>) => void): () => void;
}

export interface TradewindEventPort {
  unified(): PreparedTradewindEventStream;
  meeting(nodeId: string): PreparedTradewindEventStream;
}
