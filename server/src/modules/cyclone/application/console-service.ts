import type { CycloneDispatch } from '../../../engine/cyclone/dispatch-store.js';
import { workshopWorkspace } from '../../../engine/cyclone/paths.js';
import type { SeatJournalRecord } from '../../../engine/cyclone/seat-event-journal.js';
import type { SeatHistoryRecord } from '../../../engine/cyclone/seat-history.js';
import { frameworkError } from '../../../engine/shared/framework-error.js';
import type {
  CycloneConsoleEvent, CycloneConsoleSeat, CycloneConsoleSeatFacts,
  CycloneSeatActivityInput, CycloneSeatActivityPage, CycloneWorkshopConsole,
} from '../domain/console.js';
import { CycloneConsoleSource, type CycloneSeatMetadata } from '../infrastructure/console-source.js';
import type { CycloneRunRepository } from '../infrastructure/run-repository.js';
import type { CycloneWorkshopService } from './workshop-service.js';
import { pageSeatActivity, projectConsoleEvents, projectSeatEvents } from './console-activity.js';
import type { CycloneSupervisorSummary } from '../domain/supervisor-view.js';

type ContactSource = (workshopId: string) => Promise<SeatJournalRecord[]>;

export class CycloneConsoleService {
  private readonly source: CycloneConsoleSource;

  constructor(
    private readonly dataDir: string,
    private readonly workshops: CycloneWorkshopService,
    private readonly runs: CycloneRunRepository,
    private readonly contacts: ContactSource,
    private readonly supervisor?: (workshopId: string) => Promise<CycloneSupervisorSummary>,
  ) { this.source = new CycloneConsoleSource(dataDir); }

  dispose(): void { this.source.dispose(); }

  async read(workshopId: string): Promise<CycloneWorkshopConsole> {
    const workshop = await this.workshops.require(workshopId);
    const [metadata, runs, dispatches, contacts, histories] = await Promise.all([
      Promise.all(workshop.seatIds.map(id => this.source.seat(workshopId, id))),
      this.runs.history(workshopId), this.source.dispatches(workshopId),
      this.contacts(workshopId),
      Promise.allSettled(workshop.seatIds.map(id => this.source.history(workshopId, id))),
    ]);
    const titles = new Map(metadata.map(seat => [seat.id, seat.title]));
    const events = projectConsoleEvents(runs, dispatches, contacts,
      histories.flatMap(result => result.status === 'fulfilled' ? result.value : []), titles);
    const capabilities = new Map<string, ReturnType<CycloneConsoleSource['capabilities']>>();
    const seats = await Promise.all(metadata.map((seat, index) => {
      if (!capabilities.has(seat.agentId)) {
        capabilities.set(seat.agentId, this.source.capabilities(seat.agentId));
      }
      return this.seat(workshopId, seat, events, dispatches, contacts,
        capabilities.get(seat.agentId)!, histories[index]);
    }));
    return {
      workshopId: workshop.id, title: workshop.title,
      workspacePath: workshopWorkspace(this.dataDir, workshop.id),
      capturedAt: new Date().toISOString(), seats, recent: events.slice(0, 20),
      ...(this.supervisor ? { supervisor: await this.supervisor(workshopId) } : {}),
      stats: { seatCount: seats.length,
        executionCount: runs.filter(run => run.targetKind === 'seat').length + contacts.length,
        dispatchCount: dispatches.length,
        memoryCount: seats.some(seat => seat.stats.memoryCount === null) ? null
          : seats.reduce((sum, seat) => sum + (seat.stats.memoryCount ?? 0), 0) },
    };
  }

  async readSeatHistory(input: CycloneSeatActivityInput): Promise<CycloneSeatActivityPage> {
    return (await this.readSeatHistoryFacts(input)).page;
  }

  /** Targeted views omit capability catalogs and conversation content. */
  async readSeatHistoryFacts(input: CycloneSeatActivityInput): Promise<{
    seat: CycloneConsoleSeatFacts; page: CycloneSeatActivityPage; outgoingDispatches: {
      total: number; open: number; completed: number; failed: number;
    };
  }> {
    const workshop = await this.workshops.require(input.workshopId);
    if (!workshop.seatIds.includes(input.seatId)) throw frameworkError({
      code: 'CYCLONE_SEAT_NOT_FOUND', kind: 'not_found', message: '工位不属于此工作室或已删除',
      source: 'cyclone.console', retryable: false,
    });
    const [seat, runs, dispatches, contacts, history] = await Promise.all([
      this.source.seat(input.workshopId, input.seatId), this.runs.history(input.workshopId),
      this.source.dispatches(input.workshopId), this.contacts(input.workshopId),
      Promise.allSettled([this.source.history(input.workshopId, input.seatId)]).then(items => items[0]),
    ]);
    // A history page must not present a partial corrupt history as a complete result.
    if (history.status === 'rejected') throw history.reason;
    const titles = new Map([[seat.id, seat.title]]);
    const contacted = [...new Set(contacts.filter(item => item.sourceSeatId === seat.id)
      .map(item => item.seatId))].filter(id => id !== seat.id && workshop.seatIds.includes(id));
    await Promise.all(contacted.map(async id => {
      titles.set(id, (await this.source.seat(input.workshopId, id)).title);
    }));
    const events = projectConsoleEvents(runs, dispatches, contacts, history.value,
      titles);
    const own = projectSeatEvents(seat, events, dispatches, contacts);
    const summary = await this.seatFacts(input.workshopId, seat, events, own, history);
    const outgoing = dispatches.filter(item => item.sourceSeatId === seat.id);
    return { seat: summary, page: pageSeatActivity(own, input, new Date().toISOString()),
      outgoingDispatches: { total: outgoing.length,
        open: outgoing.filter(item => ['queued', 'running', 'awaiting_human'].includes(item.status)).length,
        completed: outgoing.filter(item => item.status === 'completed').length,
        failed: outgoing.filter(item => item.status === 'failed').length } };
  }

  private async seat(
    workshopId: string, seat: CycloneSeatMetadata, events: CycloneConsoleEvent[],
    dispatches: CycloneDispatch[], contacts: SeatJournalRecord[],
    capabilities: ReturnType<CycloneConsoleSource['capabilities']>,
    history: PromiseSettledResult<SeatHistoryRecord[]>,
  ): Promise<CycloneConsoleSeat> {
    const own = projectSeatEvents(seat, events, dispatches, contacts);
    const [facts, inherited] = await Promise.all([
      this.seatFacts(workshopId, seat, events, own, history),
      Promise.allSettled([capabilities]).then(items => items[0]),
    ]);
    const error = inherited.status === 'rejected'
      ? [facts.error, inherited.reason instanceof Error ? inherited.reason.message : '工位能力读取失败']
        .filter(Boolean).join('；') : facts.error;
    return { ...facts, recent: own.slice(0, 12),
      capabilities: inherited.status === 'fulfilled' ? inherited.value
        : { available: false, agentName: seat.agentId, model: '', tools: [], skills: [] },
      ...(error ? { error } : {}) };
  }

  private async seatFacts(
    workshopId: string, seat: CycloneSeatMetadata, events: CycloneConsoleEvent[],
    own: CycloneConsoleEvent[], history: PromiseSettledResult<SeatHistoryRecord[]>,
  ): Promise<CycloneConsoleSeatFacts> {
    const [memory] = await Promise.allSettled([this.source.memoryCount(workshopId, seat.id)]);
    const received = events.filter(event => event.seatId === seat.id);
    const errors = [memory, history].filter(result => result.status === 'rejected')
      .map(result => result.reason instanceof Error ? result.reason.message : '工位资料读取失败');
    return { ...seat,
      stats: {
        executionCount: received.filter(event => event.kind === 'execution' || event.kind === 'contact').length,
        dispatchCount: own.filter(event => event.kind === 'dispatch').length,
        memoryCount: memory.status === 'fulfilled' ? memory.value : null,
      },
      ...(errors.length ? { error: errors.join('；') } : {}),
    };
  }
}
