/** Shared input contract for project-scoped and external structure management. */
export function collaborationStructureProperties() {
  const id = { type: 'string', minLength: 1, maxLength: 160 };
  const point = { type: 'object', additionalProperties: false, required: ['x', 'y'],
    properties: { x: { type: 'number' }, y: { type: 'number' } } };
  return {
    expectedRevision: { type: 'integer', minimum: 0 },
    groups: { type: 'array', maxItems: 100, items: { type: 'object', additionalProperties: false,
      required: ['id', 'title', 'seatIds', 'position'], properties: {
        id, title: { type: 'string', minLength: 1, maxLength: 2_000 },
        seatIds: { type: 'array', maxItems: 50, uniqueItems: true, items: id }, position: point,
        size: { type: 'object', additionalProperties: false, required: ['width', 'height'],
          properties: { width: { type: 'number', exclusiveMinimum: 0 },
            height: { type: 'number', exclusiveMinimum: 0 } } },
      } } },
    externalRelations: { type: 'array', maxItems: 1_000, items: { type: 'object',
      additionalProperties: false, required: ['id', 'sourceSeatId', 'targetSeatId', 'direction'],
      properties: { id, sourceSeatId: id, targetSeatId: id,
        direction: { type: 'string', enum: ['both', 'forward'] } } } },
    seatPositions: { type: 'object', additionalProperties: point },
  };
}
