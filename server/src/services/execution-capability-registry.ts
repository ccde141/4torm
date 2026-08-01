import type { ObservationScope } from './execution-observation-contract.js';

export interface ExecutionCapabilityOwner {
  scope: ObservationScope;
  ownerId: string;
}

export interface ExecutionCapabilityToolInput {
  dataDir: string;
  agentId: string;
  args: Record<string, string>;
  observation?: ExecutionCapabilityOwner;
  signal?: AbortSignal;
}

export interface ExecutionCapabilitySurfaceInput extends ExecutionCapabilityOwner {
  id: string;
}

export interface ExecutionCapabilityProvider {
  id: string;
  tool?: {
    name: string;
    execute(input: ExecutionCapabilityToolInput): Promise<string>;
  };
  surface?: {
    viewer: string;
    control?(input: ExecutionCapabilitySurfaceInput, next: 'agent' | 'human'): Promise<void>;
    refresh?(input: ExecutionCapabilitySurfaceInput): Promise<void>;
    close?(input: ExecutionCapabilitySurfaceInput): Promise<void>;
  };
}

/**
 * Internal provider seam for privileged execution capabilities. Registration is
 * synchronous and fail-fast so startup can never silently replace a provider.
 */
export class ExecutionCapabilityRegistry {
  private readonly providers = new Map<string, ExecutionCapabilityProvider>();
  private readonly tools = new Map<string, NonNullable<ExecutionCapabilityProvider['tool']>>();
  private readonly surfaces = new Map<string, NonNullable<ExecutionCapabilityProvider['surface']>>();

  register(provider: ExecutionCapabilityProvider): void {
    if (this.providers.has(provider.id)) throw new Error(`execution capability id ${provider.id} is already registered`);
    if (provider.tool && this.tools.has(provider.tool.name)) throw new Error(`execution capability tool ${provider.tool.name} is already registered`);
    if (provider.surface && this.surfaces.has(provider.surface.viewer)) throw new Error(`execution surface viewer ${provider.surface.viewer} is already registered`);
    this.providers.set(provider.id, provider);
    if (provider.tool) this.tools.set(provider.tool.name, provider.tool);
    if (provider.surface) this.surfaces.set(provider.surface.viewer, provider.surface);
  }

  hasTool(name: string): boolean {
    return this.tools.has(name);
  }

  findTool(name: string): ExecutionCapabilityProvider['tool'] | undefined {
    return this.tools.get(name);
  }

  requireTool(name: string): NonNullable<ExecutionCapabilityProvider['tool']> {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`execution capability tool ${name} is not registered`);
    return tool;
  }

  requireSurface(viewer: string): NonNullable<ExecutionCapabilityProvider['surface']> {
    const surface = this.surfaces.get(viewer);
    if (!surface) throw new Error(`execution surface provider ${viewer} is not registered`);
    return surface;
  }
}
