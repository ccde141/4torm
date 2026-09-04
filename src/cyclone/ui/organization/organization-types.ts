export interface OrganizationPoint { x: number; y: number }
export interface OrganizationSize { width: number; height: number }

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

export interface WorkshopOrganization {
  version: 2;
  revision: number;
  updatedAt: string;
  groups: WorkGroup[];
  externalRelations: ExternalRelation[];
  seatPositions?: Record<string, OrganizationPoint>;
}

export type WorkshopOrganizationState =
  | { mode: 'legacy-full-mesh'; organization: null }
  | { mode: 'explicit'; organization: WorkshopOrganization };

export interface OrganizationSeat {
  id: string;
  agentId: string;
  title: string;
  duty?: string;
  pending?: boolean;
}

export interface EditableOrganization {
  baseRevision: number;
  activatesExplicitMode: boolean;
  groups: WorkGroup[];
  externalRelations: ExternalRelation[];
  seatPositions: Record<string, OrganizationPoint>;
}
