import type { ToolDef } from '../tool-defs-loader.js';
import { mapToolParameterSchema } from '../tool-parameter-schema.js';

export function mapAnthropicTools(defs: ToolDef[]) {
  const used = new Set(defs.map(def => def.name)
    .filter(name => /^[a-zA-Z0-9_-]+$/.test(name)));
  const nameMap = new Map<string, string>();
  const forwardMap = new Map<string, string>();
  const tools = defs.map(def => {
    const name = /^[a-zA-Z0-9_-]+$/.test(def.name)
      ? def.name : safeToolName(def.name, used);
    if (name !== def.name) nameMap.set(name, def.name);
    forwardMap.set(def.name, name);
    return {
      name,
      description: def.description ?? '',
      input_schema: mapToolParameterSchema(def.parameters),
    };
  });
  return { tools, nameMap, forwardMap };
}

function safeToolName(name: string, used: Set<string>): string {
  const base = name.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'tool';
  let candidate = base;
  let suffix = 1;
  while (used.has(candidate)) candidate = `${base}_${suffix++}`;
  used.add(candidate);
  return candidate;
}
