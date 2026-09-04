export const WORKSHOP_ORGANIZATION_VERSION = 2 as const;

export interface OrganizationPoint {
  x: number;
  y: number;
}

export interface OrganizationSize {
  width: number;
  height: number;
}

export interface WorkGroup {
  id: string;
  title: string;
  seatIds: string[];
  position: OrganizationPoint;
  size?: OrganizationSize;
}

export interface ExternalRelation {
  id: string;
  sourceSeatId: string;
  targetSeatId: string;
  direction: 'both' | 'forward';
}

export interface OrganizationDraft {
  groups: WorkGroup[];
  externalRelations: ExternalRelation[];
  seatPositions?: Record<string, OrganizationPoint>;
}

export interface WorkshopOrganization extends OrganizationDraft {
  version: typeof WORKSHOP_ORGANIZATION_VERSION;
  revision: number;
  updatedAt: string;
}

export interface SaveOrganizationInput extends OrganizationDraft {
  expectedRevision: number;
}

export type WorkshopOrganizationState =
  | { mode: 'legacy-full-mesh'; organization: null }
  | { mode: 'explicit'; organization: WorkshopOrganization };
