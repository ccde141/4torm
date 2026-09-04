import type { OrganizationPoint, WorkGroup } from './organization-types';

interface NodeSize {
  width: number;
  height: number;
}

export function findContainingGroup(
  groups: WorkGroup[],
  nodePosition: OrganizationPoint,
  nodeSize: NodeSize,
): WorkGroup | undefined {
  const center = {
    x: nodePosition.x + nodeSize.width / 2,
    y: nodePosition.y + nodeSize.height / 2,
  };
  return groups.find(group => {
    const size = group.size ?? { width: 320, height: 240 };
    return center.x >= group.position.x && center.x <= group.position.x + size.width
      && center.y >= group.position.y && center.y <= group.position.y + size.height;
  });
}
