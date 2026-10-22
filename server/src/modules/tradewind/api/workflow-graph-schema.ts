/** 画布 graph 的公开 JSON Schema；语义校验由领域规则返回 issue。 */
export function workflowGraphSchema(): Record<string, unknown> {
  const identifier = { type: 'string', pattern: '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$' };
  return { type: 'object', additionalProperties: false, required: ['nodes', 'edges'], properties: {
    orchestration: { enum: ['strict', 'handoff'] },
    nodes: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['id', 'type', 'label', 'position', 'config'], properties: {
        id: identifier, type: identifier, label: { type: 'string', minLength: 1, maxLength: 200 },
        position: { type: 'object', additionalProperties: false, required: ['x', 'y'],
          properties: { x: { type: 'number' }, y: { type: 'number' } } },
        config: { type: 'object' }, width: { type: 'number' }, height: { type: 'number' },
        memo: { type: 'string', minLength: 1, maxLength: 2_000 },
      } } },
    edges: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['id', 'source', 'sourcePort', 'target', 'targetPort', 'kind'], properties: {
        id: identifier, source: identifier, target: identifier,
        sourcePort: { type: 'integer', minimum: 0 }, targetPort: { type: 'integer', minimum: 0 },
        kind: { enum: ['handoff', 'note'] }, rework: { type: 'boolean' },
      } } },
  } };
}
