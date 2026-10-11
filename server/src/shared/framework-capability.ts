export interface FrameworkCapabilityDescriptor {
  id: string;
  title: string;
  route: string;
  guidance: string;
  detail?: 'taskboard-state';
  /** Large action sets disclose names first, then one action schema on request. */
  actionGuide?: boolean;
  examples?: FrameworkCapabilityExample[];
}

export interface FrameworkCapabilityExample {
  scenario: string;
  actions: string[];
  confirmation: string;
}

const CAPABILITY_TOOL_PREFIX = 'framework_capability_';

export function frameworkCapabilityToolName(capabilityId: string): string {
  if (!/^[a-z][a-z0-9_-]*$/.test(capabilityId)) {
    throw new Error('FRAMEWORK_CAPABILITY_ID_INVALID');
  }
  return `${CAPABILITY_TOOL_PREFIX}${capabilityId.replaceAll('-', '_')}`;
}

export function isFrameworkCapabilityToolName(name: string): boolean {
  return name.startsWith(CAPABILITY_TOOL_PREFIX);
}
