import fs from 'node:fs/promises';
import { FrameworkError, frameworkError } from '../../shared/framework-error.js';
import { workshopOrganizationFile } from '../paths.js';
import { loadWorkshop } from '../workshop-store.js';
import { atomicWrite } from '../paths.js';
import {
  WORKSHOP_ORGANIZATION_VERSION,
  type WorkshopOrganization,
  type WorkshopOrganizationState,
} from './organization-types.js';
import {
  validateSaveOrganizationInput,
  validateOrganizationDraft,
  validateStoredOrganization,
} from './organization-validation.js';

const writeQueues = new Map<string, Promise<unknown>>();

function organizationError(
  code: string, kind: 'not_found' | 'conflict' | 'io', message: string, cause?: unknown,
): FrameworkError {
  return frameworkError({
    code, kind, message, source: 'cyclone.organization.store', retryable: false,
  }, cause === undefined ? undefined : { cause });
}

async function readRawOrganization(file: string): Promise<unknown | null> {
  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw organizationError('CYCLONE_ORGANIZATION_READ_FAILED', 'io', '读取工作室组织配置失败', error);
  }
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    throw organizationError(
      'CYCLONE_ORGANIZATION_CORRUPT', 'io', '工作室组织配置已损坏，请检查原文件', error,
    );
  }
}

async function requireWorkshop(dataDir: string, workshopId: string) {
  const workshop = await loadWorkshop(dataDir, workshopId);
  if (!workshop) {
    throw organizationError(
      'CYCLONE_WORKSHOP_NOT_FOUND', 'not_found', `工作室不存在：${workshopId}`,
    );
  }
  return workshop;
}

function enqueueWrite<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = writeQueues.get(key) ?? Promise.resolve();
  const current = previous.then(task, task);
  writeQueues.set(key, current);
  return current.finally(() => {
    if (writeQueues.get(key) === current) writeQueues.delete(key);
  });
}

export async function loadWorkshopOrganization(
  dataDir: string, workshopId: string,
): Promise<WorkshopOrganizationState> {
  const workshop = await requireWorkshop(dataDir, workshopId);
  const raw = await readRawOrganization(workshopOrganizationFile(dataDir, workshopId));
  if (raw === null) return { mode: 'legacy-full-mesh', organization: null };
  return {
    mode: 'explicit',
    organization: validateStoredOrganization(raw, workshop.seatIds),
  };
}

export async function saveWorkshopOrganization(
  dataDir: string, workshopId: string, input: unknown,
): Promise<WorkshopOrganization> {
  const file = workshopOrganizationFile(dataDir, workshopId);
  return enqueueWrite(file, async () => {
    const workshop = await requireWorkshop(dataDir, workshopId);
    const raw = await readRawOrganization(file);
    const current = raw === null ? null : validateStoredOrganization(raw, workshop.seatIds);
    const validated = validateSaveOrganizationInput(input, workshop.seatIds);
    const revision = current?.revision ?? 0;
    if (validated.expectedRevision !== revision) {
      throw organizationError(
        'CYCLONE_ORGANIZATION_REVISION_CONFLICT', 'conflict',
        `组织配置版本冲突：当前 revision=${revision}，本次基于 revision=${validated.expectedRevision}`,
      );
    }
    const organization: WorkshopOrganization = {
      version: WORKSHOP_ORGANIZATION_VERSION,
      revision: revision + 1,
      updatedAt: new Date().toISOString(),
      groups: validated.groups,
      externalRelations: validated.externalRelations,
      ...(validated.seatPositions ? { seatPositions: validated.seatPositions } : {}),
    };
    await atomicWrite(file, JSON.stringify(organization, null, 2));
    return organization;
  });
}

export async function removeSeatFromOrganization(
  dataDir: string, workshopId: string, seatId: string,
): Promise<WorkshopOrganization | null> {
  const file = workshopOrganizationFile(dataDir, workshopId);
  return enqueueWrite(file, async () => {
    const workshop = await requireWorkshop(dataDir, workshopId);
    const raw = await readRawOrganization(file);
    if (raw === null) return null;
    const readableSeatIds = [...new Set([...workshop.seatIds, seatId])];
    const current = validateStoredOrganization(raw, readableSeatIds);
    const groups = current.groups.map(group => ({
      ...group, seatIds: group.seatIds.filter(id => id !== seatId),
    }));
    const externalRelations = current.externalRelations.filter(relation => (
      relation.sourceSeatId !== seatId && relation.targetSeatId !== seatId
    ));
    const seatPositions = current.seatPositions
      ? Object.fromEntries(Object.entries(current.seatPositions).filter(([id]) => id !== seatId))
      : undefined;
    const referenced = groups.some((group, index) => group.seatIds.length !== current.groups[index].seatIds.length)
      || externalRelations.length !== current.externalRelations.length
      || (current.seatPositions !== undefined && seatPositions?.[seatId] === undefined
        && Object.hasOwn(current.seatPositions, seatId));
    if (!referenced) return current;
    const organization: WorkshopOrganization = {
      version: WORKSHOP_ORGANIZATION_VERSION,
      revision: current.revision + 1,
      updatedAt: new Date().toISOString(),
      ...validateOrganizationDraft(
        { groups, externalRelations, seatPositions }, workshop.seatIds.filter(id => id !== seatId),
      ),
    };
    await atomicWrite(file, JSON.stringify(organization, null, 2));
    return organization;
  });
}
