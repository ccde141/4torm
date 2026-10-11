import { useEffect, useState } from 'react';
import type { WorkspaceTab } from '../organization/workspace-tabs';
import type { RoomSummary, SeatSummary, WorkshopSummary } from './cyclone-page-model';
import { parseCycloneActivityTarget } from './cyclone-activity-target';

interface Input {
  active: boolean | undefined;
  preselectOperation: string | null | undefined;
  onClearPreselect: (() => void) | undefined;
  workshopsLoaded: boolean;
  workshops: WorkshopSummary[];
  activeWid: string | null;
  setActiveWid: (id: string) => void;
  loadedWorkshopId: string | null;
  seats: SeatSummary[];
  rooms: RoomSummary[];
  openWorkspaceView: (tab: WorkspaceTab) => void;
}

export function useCycloneActivityNavigation(input: Input): string {
  const [error, setError] = useState('');
  const { active, preselectOperation, onClearPreselect, workshopsLoaded, workshops,
    activeWid, setActiveWid, loadedWorkshopId, seats, rooms, openWorkspaceView } = input;
  useEffect(() => {
    if (!active || !preselectOperation || !workshopsLoaded) return;
    const target = parseCycloneActivityTarget(preselectOperation);
    if (!target || !workshops.some(item => item.id === target.workshopId)) {
      setError('关联的气旋工作室已不存在');
      onClearPreselect?.();
      return;
    }
    setError('');
    if (activeWid !== target.workshopId) setActiveWid(target.workshopId);
    if (!target.kind) onClearPreselect?.();
  }, [active, activeWid, onClearPreselect, preselectOperation, setActiveWid,
    workshops, workshopsLoaded]);
  useEffect(() => {
    if (!active || !preselectOperation) return;
    const target = parseCycloneActivityTarget(preselectOperation);
    if (!target?.kind || loadedWorkshopId !== target.workshopId) return;
    const entity = target.kind === 'seat'
      ? seats.find(item => item.id === target.id)
      : rooms.find(item => item.id === target.id);
    if (entity) openWorkspaceView({ kind: target.kind, id: entity.id, title: entity.title });
    else setError('关联的气旋会话已不存在');
    onClearPreselect?.();
  }, [active, loadedWorkshopId, onClearPreselect, openWorkspaceView,
    preselectOperation, rooms, seats]);
  return error;
}
