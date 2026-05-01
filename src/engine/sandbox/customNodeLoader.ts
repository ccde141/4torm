import React from 'react';
import type { NodeTypes } from '@xyflow/react';
import type { ConfigField, NodeConfigSchema } from '../../components/sandbox/configSchema';
import { registerConfigSchema } from '../../components/sandbox/configSchema';
import CustomNodeBase from '../../components/sandbox/nodes/CustomNodeBase';

export interface CustomNodeMeta {
  type: string;
  label: string;
  category: string;
  color: string;
  inputs: number;
  outputs: number;
  config_schema: Array<{
    key: string;
    label: string;
    type: string;
    options?: string[];
    default?: unknown;
  }>;
  hasPanel: boolean;
}

let cachedNodes: CustomNodeMeta[] = [];
let registeredTypes: NodeTypes = {};

export async function fetchCustomNodes(): Promise<CustomNodeMeta[]> {
  try {
    const res = await fetch('/api/custom-nodes');
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    cachedNodes = data;
    return cachedNodes;
  } catch {
    return [];
  }
}

export function getCustomNodeMeta(): CustomNodeMeta[] {
  return cachedNodes;
}

export function getCustomNodeTypes(): NodeTypes {
  return registeredTypes;
}

export interface PaletteEntry {
  type: string;
  label: string;
  icon: string;
  color: string;
}

export async function registerCustomNodes(): Promise<{
  customTypes: NodeTypes;
  paletteEntries: PaletteEntry[];
}> {
  const nodes = await fetchCustomNodes();
  const customTypes: NodeTypes = {};
  const paletteEntries: PaletteEntry[] = [];

  for (const node of nodes) {
    const color = node.color || '#6366f1';

    // Create a component bound to this node's color
    const BoundComponent = (props: any) =>
      React.createElement(CustomNodeBase, { ...props, color });

    BoundComponent.displayName = `CustomNode_${node.type}`;
    customTypes[node.type] = BoundComponent;

    // Register config schema
    const schema: NodeConfigSchema = (node.config_schema || []).map((f: any) => ({
      key: f.key,
      label: f.label,
      type: (f.type === 'select' ? 'select' : f.type === 'toggle' ? 'toggle' : f.type === 'number' ? 'number' : f.type === 'textarea' ? 'textarea' : f.type === 'json' ? 'json' : 'text') as ConfigField['type'],
      options: f.options,
      default: f.default,
      placeholder: undefined,
    }));
    registerConfigSchema(node.type, schema);

    paletteEntries.push({
      type: node.type,
      label: node.label,
      icon: '⚙',
      color,
    });
  }

  registeredTypes = customTypes;
  return { customTypes, paletteEntries };
}
