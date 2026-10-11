export interface WorkshopData {
  id: string;
  title: string;
  chairAgentId?: string;
  seatIds: string[];
  roomIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface WorkshopSummary {
  id: string;
  title: string;
  seatCount: number;
  roomCount: number;
  createdAt: string;
  updatedAt: string;
}
