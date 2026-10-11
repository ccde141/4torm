import type { FrameworkCapabilityDescriptor } from '../shared/framework-capability.js';

export type ToolExecutionMode = 'sync' | 'detachable';

export interface ToolDefinition {
  name: string;
  description: string;
  category?: string;
  dangerous?: boolean;
  parameters?: {
    type?: string;
    properties?: Record<string, { type?: string; description?: string; [keyword: string]: unknown }>;
    required?: string[];
    [keyword: string]: unknown;
  };
  executorType?: string;
  executorFile?: string;
  executorTemplate?: string;
  /** sync=调用方等待完成；detachable=超过同步窗口后可转为后台执行。 */
  executionMode?: ToolExecutionMode;
  /** Framework-owned routing metadata; omitted from provider tool schemas. */
  frameworkCapability?: FrameworkCapabilityDescriptor;
}

export interface ToolCatalogEntry extends ToolDefinition {
  source: 'framework' | 'custom';
  readonly: boolean;
}
