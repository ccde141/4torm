export interface WorkshopActivitySnapshot {
  runningSeatIds: string[];
  activities: Record<string, { id: string; kind: string; sourceSeatId?: string }>;
}

export interface WorkshopActivityPort {
  read(workshopId: string): WorkshopActivitySnapshot;
}
