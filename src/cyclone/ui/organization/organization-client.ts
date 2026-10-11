import { errorFromResponse } from '../../../api/error-contract.js';
import { invokeFeature } from '../../../api/collaboration.js';
import type { EditableOrganization, WorkshopOrganization, WorkshopOrganizationState } from './organization-types.js';

function endpoint(workshopId: string): string {
  return `/api/cyclone/workshop/${encodeURIComponent(workshopId)}/organization`;
}

export async function loadOrganization(
  workshopId: string, signal?: AbortSignal,
): Promise<WorkshopOrganizationState> {
  const response = await fetch(endpoint(workshopId), { signal });
  if (!response.ok) throw await errorFromResponse(response, '加载工作室组织图失败');
  return response.json();
}

export async function saveOrganization(
  workshopId: string, draft: EditableOrganization,
): Promise<WorkshopOrganization> {
  return invokeFeature('cyclone', 'saveWorkshopOrganization', {
    workshopId,
    expectedRevision: draft.baseRevision,
    groups: draft.groups,
    externalRelations: draft.externalRelations,
    seatPositions: draft.seatPositions,
  });
}
