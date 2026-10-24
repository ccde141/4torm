import type { FeatureModule } from '../../../engine/collaboration/contracts.js';
import { MonsoonRuntime } from '../application/runtime.js';
import { MonsoonChatPreparation } from '../application/chat-preparation.js';
import { createMonsoonModule } from './module.js';
import { FileMonsoonRunRepository } from '../infrastructure/run-repository.js';
import { FileMonsoonSessionRepository } from '../infrastructure/session-repository.js';
import { FileMonsoonTurnJournal } from '../infrastructure/turn-journal.js';
import { FileMonsoonTeamReader } from '../infrastructure/team-reader.js';
import { MonsoonTeamQuery } from '../application/team-query.js';
import { createMonsoonChatPorts } from '../runtime/chat-context-adapter.js';
import { acquireMonsoonSessionLease } from '../runtime/session-lease-adapter.js';
import { MonsoonInputService } from '../application/input-service.js';
import { createMonsoonInputJournalPort } from '../runtime/input-journal-adapter.js';
import {
  createMonsoonTitleGenerator, type MonsoonTitleGenerator,
} from '../runtime/title-adapter.js';
import { MonsoonTurnService } from '../application/turn-service.js';
import { MonsoonAttachmentService } from '../application/attachment-service.js';
import { MonsoonCompactionService } from '../application/compaction-service.js';
import { summarizeMonsoonCompaction } from '../runtime/compaction-summarizer.js';
import { createMonsoonExternalSessionPort } from '../runtime/external-session-adapter.js';
import type { MonsoonExternalSessionPort } from '../application/external-session-port.js';
import { withMonsoonToolImages } from './tool-images.js';
import { createMonsoonInputPreview } from '../runtime/current-input.js';

export interface MonsoonFeatureOptions { dataDir: string }

export interface MonsoonFeature {
  module: FeatureModule;
  runtime: MonsoonRuntime;
  chat: MonsoonChatPreparation;
  sessions: FileMonsoonSessionRepository;
  journal: FileMonsoonTurnJournal;
  teams: MonsoonTeamQuery;
  input: MonsoonInputService;
  title: MonsoonTitleGenerator;
  turns: MonsoonTurnService;
  externalSessions: MonsoonExternalSessionPort;
}

export function createMonsoonFeature(options: MonsoonFeatureOptions): MonsoonFeature {
  const runs = new FileMonsoonRunRepository(options.dataDir);
  const sessions = new FileMonsoonSessionRepository(options.dataDir);
  const runtime = new MonsoonRuntime(
    runs, acquireMonsoonSessionLease,
  );
  const journal = new FileMonsoonTurnJournal(options.dataDir);
  const teams = new MonsoonTeamQuery(new FileMonsoonTeamReader(options.dataDir));
  const input = new MonsoonInputService(
    sessionId => runtime.get(sessionId), createMonsoonInputJournalPort(options.dataDir),
  );
  const chat = new MonsoonChatPreparation(options.dataDir, runtime, createMonsoonChatPorts());
  const turns = new MonsoonTurnService({ chat, runtime, sessions, journal });
  const title = createMonsoonTitleGenerator(options.dataDir);
  return {
    module: withMonsoonToolImages(createMonsoonModule(runtime, teams, runs, sessions, turns,
      { sessions, journal, preview: createMonsoonInputPreview(options.dataDir) },
      new MonsoonAttachmentService(options.dataDir, sessions), input, title,
      new MonsoonCompactionService(options.dataDir, sessions, summarizeMonsoonCompaction)), options.dataDir, sessions),
    runtime, sessions, journal, teams, input, chat,
    title,
    turns,
    externalSessions: createMonsoonExternalSessionPort(options.dataDir),
  };
}
