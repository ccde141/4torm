/** Default delegation budget shared by executors and their tool/prompt descriptions. */
export const SUB_AGENT_MAX_ROUNDS = 300;

export function resolveSubAgentRounds(requested = SUB_AGENT_MAX_ROUNDS): number {
  if (!Number.isSafeInteger(requested) || requested < 1) throw new Error('SubAgent 轮次必须是正整数');
  return Math.min(requested, SUB_AGENT_MAX_ROUNDS);
}
