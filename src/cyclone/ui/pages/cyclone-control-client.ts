import { invokeFeature } from '../../../api/collaboration';
import type { ExpectedRoomMessage } from './room-message-identity';
import { compactSupervisor, mutateSupervisorMessage, resetSupervisor } from './supervisor-client';

export interface CycloneEntityReceipt {
  id: string;
  title: string;
  [key: string]: unknown;
}

export interface CycloneSeatPatch {
  agentId?: string;
  title?: string;
  rolePrompt?: string;
  duty?: string;
  overrideAgentRole?: boolean;
}

export interface CycloneRoomInput {
  title?: string;
  topic?: string;
  participantSeatIds?: string[];
  mode?: 'build' | 'plan';
}

export type CycloneBulletinOperation =
  | { op: 'add'; text: string; author?: string }
  | { op: 'update' | 'restore'; id: string; text: string; author?: string }
  | { op: 'remove'; id: string };

export type CyclonePrivateTarget =
  | { kind: 'seat'; seatId: string }
  | { kind: 'chair'; roomId: string }
  | { kind: 'supervisor' };

export function createCycloneWorkshop(input: {
  title?: string;
  chairAgentId?: string;
}): Promise<CycloneEntityReceipt> {
  return invokeFeature('cyclone', 'createWorkshop', input);
}

export function deleteCycloneWorkshop(workshopId: string): Promise<unknown> {
  return invokeFeature('cyclone', 'deleteWorkshop', { workshopId });
}

export function setCycloneChair(workshopId: string, chairAgentId: string): Promise<unknown> {
  return invokeFeature('cyclone', 'setWorkshopChair', { workshopId, chairAgentId });
}

export function addCycloneSeat(
  workshopId: string,
  input: CycloneSeatPatch & { agentId: string },
): Promise<CycloneEntityReceipt> {
  return invokeFeature('cyclone', 'addWorkshopSeat', { workshopId, ...input });
}

export function updateCycloneSeat(
  workshopId: string,
  seatId: string,
  patch: CycloneSeatPatch,
): Promise<CycloneEntityReceipt> {
  return invokeFeature('cyclone', 'updateSeatRole', { workshopId, seatId, ...patch });
}

export function deleteCycloneSeat(workshopId: string, seatId: string): Promise<unknown> {
  return invokeFeature('cyclone', 'deleteSeat', { workshopId, seatId });
}

export function createCycloneRoom(
  workshopId: string,
  input: CycloneRoomInput,
): Promise<CycloneEntityReceipt> {
  return invokeFeature('cyclone', 'createRoom', {
    workshopId,
    title: input.title,
    topic: input.topic,
    participantSeatIds: input.participantSeatIds,
    mode: input.mode,
  });
}

export function deleteCycloneRoom(workshopId: string, roomId: string): Promise<unknown> {
  return invokeFeature('cyclone', 'deleteRoom', { workshopId, roomId });
}

export function openCycloneWorkspace(
  workshopId: string,
): Promise<{ ok: true; path: string }> {
  return invokeFeature('cyclone', 'openWorkshopWorkspace', { workshopId });
}

export function renameCycloneWorkshop(workshopId: string, title: string): Promise<unknown> {
  return invokeFeature('cyclone', 'renameWorkshop', { workshopId, title });
}

export function generateCycloneSeatDuty(
  agentId: string,
  title: string,
  rolePrompt?: string,
): Promise<{ duty: string }> {
  return invokeFeature('cyclone', 'generateSeatDuty', {
    agentId, title, ...(rolePrompt === undefined ? {} : { rolePrompt }),
  });
}

export function mutateCycloneBulletin(
  workshopId: string,
  operations: CycloneBulletinOperation[],
): Promise<unknown> {
  return invokeFeature('cyclone', 'mutateWorkshopBulletin', { workshopId, operations });
}

export function revertCycloneBulletin(workshopId: string, sequence: number): Promise<unknown> {
  return invokeFeature('cyclone', 'revertWorkshopBulletin', { workshopId, sequence });
}

export function joinCycloneRoom(
  workshopId: string, roomId: string, seatId: string,
): Promise<unknown> {
  return invokeFeature('cyclone', 'joinRoom', { workshopId, roomId, seatId });
}

export function leaveCycloneRoom(
  workshopId: string, roomId: string, seatId: string,
): Promise<unknown> {
  return invokeFeature('cyclone', 'leaveRoom', { workshopId, roomId, seatId });
}

export function reorderCycloneRoom(
  workshopId: string, roomId: string, seatIds: string[],
): Promise<unknown> {
  return invokeFeature('cyclone', 'setRoomParticipants', { workshopId, roomId, seatIds });
}

export function renameCycloneRoom(
  workshopId: string, roomId: string, title: string,
): Promise<unknown> {
  return invokeFeature('cyclone', 'renameRoom', { workshopId, roomId, title });
}

export function setCycloneRoomTopic(
  workshopId: string, roomId: string, topic: string,
): Promise<unknown> {
  return invokeFeature('cyclone', 'setRoomTopic', { workshopId, roomId, topic });
}

export function setCycloneRoomMode(
  workshopId: string, roomId: string, mode: 'build' | 'plan',
): Promise<unknown> {
  return invokeFeature('cyclone', 'setRoomMode', { workshopId, roomId, mode });
}

export function editCyclonePrivateMessage(
  workshopId: string, target: CyclonePrivateTarget, index: number, content: string,
): Promise<unknown> {
  if (target.kind === 'supervisor') return mutateSupervisorMessage(workshopId, index, content);
  const method = target.kind === 'seat' ? 'editSeatMessage' : 'editChairMessage';
  return invokeFeature('cyclone', method, { workshopId, ...targetIdentity(target), index, content });
}

export function deleteCyclonePrivateMessage(
  workshopId: string, target: CyclonePrivateTarget, index: number,
): Promise<unknown> {
  if (target.kind === 'supervisor') return mutateSupervisorMessage(workshopId, index);
  const method = target.kind === 'seat' ? 'deleteSeatMessage' : 'deleteChairMessage';
  return invokeFeature('cyclone', method, { workshopId, ...targetIdentity(target), index });
}

export function resetCyclonePrivateContext(
  workshopId: string,
  target: CyclonePrivateTarget,
  mode: 'clear' | 'summary',
  forcePending = false, signal?: AbortSignal,
): Promise<unknown> {
  if (target.kind === 'supervisor') return resetSupervisor(workshopId, mode, signal);
  if (target.kind === 'chair') return invokeFeature('cyclone', 'resetChairContext', {
    workshopId, roomId: target.roomId, mode,
  }, undefined, { signal });
  return invokeFeature('cyclone', 'resetSeatContext', {
    workshopId, seatId: target.seatId, mode, forcePending,
  }, undefined, { signal });
}

export function compactCyclonePrivateContext(
  workshopId: string, target: CyclonePrivateTarget, signal?: AbortSignal,
): Promise<unknown> {
  if (target.kind === 'supervisor') return compactSupervisor(workshopId, signal);
  const method = target.kind === 'chair' ? 'compactChairContext' : 'compactSeatContext';
  return invokeFeature('cyclone', method, { workshopId, ...targetIdentity(target) }, undefined, { signal });
}

export function editCycloneRoomMessage(
  workshopId: string, roomId: string, index: number, content: string,
  expectedMessage?: ExpectedRoomMessage,
): Promise<unknown> {
  return invokeFeature('cyclone', 'editRoomMessage', {
    workshopId, roomId, index, content, expectedMessage,
  });
}

export function deleteCycloneRoomMessage(
  workshopId: string, roomId: string, index: number,
  expectedMessage?: ExpectedRoomMessage,
): Promise<unknown> {
  return invokeFeature('cyclone', 'deleteRoomMessage', {
    workshopId, roomId, index, expectedMessage,
  });
}

export function resetCycloneRoomContext(
  workshopId: string,
  roomId: string,
  mode: 'clear' | 'summary',
  scope: 'public' | 'chair' | 'both', signal?: AbortSignal,
): Promise<unknown> {
  return invokeFeature('cyclone', 'resetRoomContext', { workshopId, roomId, mode, scope }, undefined, { signal });
}

export function compactCycloneRoomContext(
  workshopId: string, roomId: string, scope: 'public' | 'chair' | 'both' = 'public', signal?: AbortSignal,
): Promise<unknown> {
  return invokeFeature('cyclone', 'compactRoomContext', { workshopId, roomId, scope }, undefined, { signal });
}

function targetIdentity(target: Exclude<CyclonePrivateTarget, { kind: 'supervisor' }>): { seatId: string } | { roomId: string } {
  return target.kind === 'seat' ? { seatId: target.seatId } : { roomId: target.roomId };
}
