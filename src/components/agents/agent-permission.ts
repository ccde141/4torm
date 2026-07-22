export type AgentPermissionLevel = 'project' | 'unrestricted';

export function normalizeAgentPermission(value: unknown): AgentPermissionLevel {
  return value === 'unrestricted' ? 'unrestricted' : 'project';
}
