import { invokeFeature } from '../../api/collaboration';

export interface TradewindAgentSummary {
  id: string;
  name: string;
  model: string;
}

export function listTradewindAgents(fallback = '加载 Agent 列表失败') {
  return invokeFeature<TradewindAgentSummary[]>('tradewind', 'listAgentSummaries', {}, fallback);
}
