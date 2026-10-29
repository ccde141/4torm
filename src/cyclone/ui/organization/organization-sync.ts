import { reconcileOrganizationSeats } from './organization-model';
import type { EditableOrganization, OrganizationSeat } from './organization-types';

function content(draft: EditableOrganization) {
  return JSON.stringify({ groups: draft.groups, externalRelations: draft.externalRelations,
    seatPositions: Object.entries(draft.seatPositions).sort(([a], [b]) => a.localeCompare(b)) });
}

/** Automatic roster/layout reconciliation does not constitute a human edit. */
export function hasOrganizationEdits(draft: EditableOrganization, saved: EditableOrganization,
  seats?: OrganizationSeat[]): boolean {
  return content(seats ? reconcileOrganizationSeats(draft, seats) : draft)
    !== content(seats ? reconcileOrganizationSeats(saved, seats) : saved);
}

export function synchronizeOrganizationDraft(current: EditableOrganization | null,
  saved: EditableOrganization | null, authoritative: EditableOrganization, seats: OrganizationSeat[]) {
  const conflict = !!current && !!saved && hasOrganizationEdits(current, saved, seats);
  return { draft: conflict ? current! : authoritative, conflict };
}
