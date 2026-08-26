export function getConvectionCreateError(agentCount: number, message = '创建会议室至少需要 2 个 Agent，请先创建或配置更多 Agent。'): string | null {
  return agentCount >= 2 ? null : message;
}
