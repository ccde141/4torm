import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import { frameworkError } from '../../../engine/shared/framework-error.js';
import {
  applyBulletinOps,
  readBulletin,
  readBulletinHistory,
  revertBulletinChange,
  type BulletinOp,
} from '../../../engine/cyclone/bulletin.js';
import { loadRoom } from '../../../engine/cyclone/room-store.js';
import { generateSeatDuty } from '../../../engine/cyclone/seat-duty.js';
import { addSeat, loadSeat } from '../../../engine/cyclone/seat-store.js';
import {
  createWorkshop,
  createWorkshopDraft,
  deleteWorkshop,
  listWorkshops,
  loadWorkshop,
  renameWorkshop,
  publishWorkshop,
  setChair,
  workshopWorkspace,
} from '../infrastructure/workshop-store.js';
import {
  loadWorkshopOrganization,
  saveWorkshopOrganization,
} from '../../../engine/cyclone/organization/organization-store.js';
import type { CycloneChangeFeed } from './change-feed.js';

export interface CreateWorkshopInput { title?: string; chairAgentId?: string }
export type WorkshopBulletinOperation = BulletinOp;
export interface AddWorkshopSeatInput {
  workshopId: string;
  agentId: string;
  title?: string;
  rolePrompt?: string;
  duty?: string;
  overrideAgentRole?: boolean;
}

export class CycloneWorkshopService {
  constructor(
    private readonly dataDir: string,
    private readonly changes?: CycloneChangeFeed,
  ) {}

  list() { return listWorkshops(this.dataDir); }

  async require(workshopId: string) {
    const workshop = await loadWorkshop(this.dataDir, workshopId);
    if (!workshop) throw workshopNotFound(workshopId);
    return workshop;
  }

  async create(input: CreateWorkshopInput) {
    const workshop = await createWorkshop(this.dataDir, input);
    this.changes?.publish(workshop.id, 'workshop', workshop.id);
    return workshop;
  }

  createDraft(input: CreateWorkshopInput) { return createWorkshopDraft(this.dataDir, input); }

  async publish(workshopId: string) {
    await publishWorkshop(this.dataDir, workshopId);
    this.changes?.publish(workshopId, 'workshop', workshopId);
  }

  discard(workshopId: string) { return deleteWorkshop(this.dataDir, workshopId); }

  async rename(workshopId: string, title: string): Promise<void> {
    await this.require(workshopId);
    await renameWorkshop(this.dataDir, workshopId, title);
    this.changes?.publish(workshopId, 'workshop', workshopId);
  }

  async remove(workshopId: string): Promise<void> {
    await this.require(workshopId);
    await deleteWorkshop(this.dataDir, workshopId);
    this.changes?.publish(workshopId, 'workshop', workshopId);
  }

  async chair(workshopId: string, chairAgentId: string) {
    await this.require(workshopId);
    const workshop = await setChair(this.dataDir, workshopId, chairAgentId);
    if (!workshop) throw workshopNotFound(workshopId);
    this.changes?.publish(workshopId, 'workshop', workshopId);
    return workshop.chairAgentId;
  }

  async addSeat(input: AddWorkshopSeatInput, notify = true) {
    await this.require(input.workshopId);
    const { workshopId, ...options } = input;
    const seat = await addSeat(this.dataDir, workshopId, options);
    if (notify) this.changes?.publish(workshopId, 'workshop', workshopId);
    return seat;
  }

  generateDuty(input: { agentId: string; title: string; rolePrompt?: string }) {
    return generateSeatDuty(this.dataDir, input);
  }

  async summary(workshopId: string) {
    const workshop = await this.require(workshopId);
    const [seats, rooms, bulletin] = await Promise.all([
      Promise.all(workshop.seatIds.map(id => loadSeat(this.dataDir, workshopId, id))),
      Promise.all(workshop.roomIds.map(id => loadRoom(this.dataDir, workshopId, id))),
      readBulletin(this.dataDir, workshopId),
    ]);
    return {
      id: workshop.id, title: workshop.title, chairAgentId: workshop.chairAgentId,
      seats: seats.filter(Boolean).map(seat => ({ id: seat!.id, agentId: seat!.agentId,
        title: seat!.title, duty: seat!.duty, pending: !!seat!.pending })),
      rooms: rooms.filter(Boolean).map(room => ({ id: room!.id, title: room!.title })),
      bulletin,
    };
  }

  async bulletin(workshopId: string) {
    await this.require(workshopId);
    return readBulletin(this.dataDir, workshopId);
  }

  async bulletinHistory(workshopId: string) {
    await this.require(workshopId);
    return readBulletinHistory(this.dataDir, workshopId);
  }

  async mutateBulletin(workshopId: string, operations: BulletinOp[]) {
    await this.require(workshopId);
    const bulletin = operations.length
      ? await applyBulletinOps(this.dataDir, workshopId, operations, '人类')
      : await readBulletin(this.dataDir, workshopId);
    return { ...bulletin, changes: await readBulletinHistory(this.dataDir, workshopId) };
  }

  async revertBulletin(workshopId: string, sequence: number) {
    await this.require(workshopId);
    const bulletin = await revertBulletinChange(this.dataDir, workshopId, sequence, '人类');
    return { ...bulletin, changes: await readBulletinHistory(this.dataDir, workshopId) };
  }

  async saveOrganization(workshopId: string, input: unknown) {
    const organization = await saveWorkshopOrganization(this.dataDir, workshopId, input);
    this.changes?.publish(workshopId, 'workshop', workshopId);
    return organization;
  }

  organization(workshopId: string) {
    return loadWorkshopOrganization(this.dataDir, workshopId);
  }

  async openWorkspace(workshopId: string): Promise<string> {
    await this.require(workshopId);
    const workspacePath = workshopWorkspace(this.dataDir, workshopId);
    await fs.mkdir(workspacePath, { recursive: true });
    const command = platformCommand(workspacePath);
    spawn(command.bin, command.args, { detached: true, stdio: 'ignore' }).unref();
    return workspacePath;
  }
}

function platformCommand(workspacePath: string): { bin: string; args: string[] } {
  if (process.platform === 'win32') return { bin: 'explorer.exe', args: [workspacePath] };
  if (process.platform === 'darwin') return { bin: 'open', args: [workspacePath] };
  return { bin: 'xdg-open', args: [workspacePath] };
}

function workshopNotFound(workshopId: string) {
  return frameworkError({
    code: 'CYCLONE_WORKSHOP_NOT_FOUND', kind: 'not_found', message: '工作室不存在',
    source: 'cyclone.workshops', retryable: false, details: { workshopId },
  });
}
