export function resolveSubAgentModel(overrideModel: string | undefined, agentModel: string): string {
  return overrideModel || agentModel;
}
