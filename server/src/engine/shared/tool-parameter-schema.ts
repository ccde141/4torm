import type { ToolDef } from './tool-defs-loader.js';

/** Preserve the tool's root JSON Schema while retaining legacy object defaults. */
export function mapToolParameterSchema(parameters: ToolDef['parameters']) {
  return {
    ...(parameters ?? {}),
    type: 'object' as const,
    properties: parameters?.properties ?? {},
    required: Array.isArray(parameters?.required) ? parameters.required : [],
  };
}
