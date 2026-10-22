import { createHash } from 'node:crypto';
import { readSupervisorInbox, readPendingSupervisorInformation } from '../../../engine/cyclone/supervisor-store.js';
import { frameworkError } from '../../../engine/shared/framework-error.js';
import type { CycloneSupervisorService } from './supervisor-service.js';

export interface ReadCollaborationSupervisorInput {
  workshopId: string; cursor?: string; limit?: number;
  informationId?: string; revision?: string; offset?: number;
}

/** Bounded Agent projection; the existing supervisor service owns all writes and executions. */
export class CycloneAgentSupervisorService {
  constructor(private readonly dataDir: string, readonly supervisor: CycloneSupervisorService) {}

  async read(input: ReadCollaborationSupervisorInput) {
    const summary = await this.supervisor.summary(input.workshopId);
    const inbox = (await readSupervisorInbox(this.dataDir, input.workshopId)).slice().reverse();
    const revision = createHash('sha256').update(JSON.stringify([input.workshopId, summary.revision,
      inbox])).digest('hex');
    const identity = { workshopId: input.workshopId, ...summary,
      supervisorRevision: summary.revision, revision };
    if (input.informationId !== undefined) {
      if (input.revision !== revision) throw changed();
      const item = inbox.find(item => item.id === input.informationId);
      if (!item) throw invalid('主管收件信息不存在或不属于当前工作室');
      const offset = input.offset ?? 0;
      if (offset > item.content.length) throw invalid('主管信息续读位置无效');
      let end = Math.min(item.content.length, offset + 6_000);
      const output = () => ({ ...identity, informationId: item.id, offset,
        totalChars: item.content.length, content: item.content.slice(offset, end),
        ...(end < item.content.length ? { nextOffset: end } : {}) });
      while (JSON.stringify(output()).length > 24_000 && end > offset + 1) {
        end = offset + Math.floor((end - offset) * 0.8);
      }
      return bounded(output());
    }
    let start = 0;
    if (input.cursor) {
      const parsed = /^([a-f0-9]{64}):(0|[1-9]\d*)$/.exec(input.cursor);
      if (!parsed || !Number.isSafeInteger(Number(parsed[2])) || Number(parsed[2]) > inbox.length) {
        throw invalid('主管收件箱游标无效');
      }
      if (parsed[1] !== revision) throw changed();
      start = Number(parsed[2]);
    }
    let end = Math.min(inbox.length, start + (input.limit ?? 8));
    const pending = (await readPendingSupervisorInformation(this.dataDir, input.workshopId)).length;
    const output = () => ({ ...identity,
      inbox: { total: inbox.length, pending,
        items: inbox.slice(start, end).map(item => ({ informationId: item.id,
          sourceKind: item.sourceKind, sourceId: item.sourceId,
          sourceTitle: item.sourceTitle.slice(0, 160), content: item.content.slice(0, 600),
          contentChars: item.content.length, contentTruncated: item.content.length > 600,
          createdAt: item.createdAt, ...(item.consumedAt ? { consumedAt: item.consumedAt } : {}) })),
        ...(end < inbox.length ? { nextCursor: `${revision}:${end}` } : {}) } });
    while (JSON.stringify(output()).length > 24_000 && end > start + 1) end--;
    return bounded(output());
  }
}
function bounded<T>(value: T): T {
  if (JSON.stringify(value).length > 24_000) throw invalid('主管记录超出读取预算，请核对工作室原始记录');
  return value;
}

function changed() {
  return frameworkError({ code: 'CYCLONE_SUPERVISOR_VIEW_CHANGED', kind: 'conflict',
    message: '主管记录已变化，请从第一页重新读取', source: 'cyclone.agent-supervisor', retryable: false });
}

function invalid(message: string) {
  return frameworkError({ code: 'CYCLONE_AGENT_SUPERVISOR_INPUT_INVALID', kind: 'validation',
    message, source: 'cyclone.agent-supervisor', retryable: false });
}
