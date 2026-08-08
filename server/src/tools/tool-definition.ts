export type ToolExecutionMode = 'sync' | 'detachable';

export interface ToolDefinition {
  name: string;
  description: string;
  category?: string;
  dangerous?: boolean;
  parameters?: {
    type?: string;
    properties?: Record<string, { type?: string; description?: string }>;
    required?: string[];
  };
  executorType?: string;
  executorFile?: string;
  executorTemplate?: string;
  /** sync=调用方等待完成；detachable=超过同步窗口后可转为后台执行。 */
  executionMode?: ToolExecutionMode;
}

export interface ToolCatalogEntry extends ToolDefinition {
  source: 'framework' | 'custom';
  readonly: boolean;
}
