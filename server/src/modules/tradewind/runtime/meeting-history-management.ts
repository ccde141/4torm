import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicWriteFile } from '../../../engine/shared/atomic-io.js';
import { getMeetingFileName, getMeetingsDir } from '../../../engine/tradewind/foundation/archive-paths.js';
import type { ActiveMeeting } from '../../../engine/tradewind/nodes/meeting.js';
import { publishMeetingCompaction } from '../../../engine/tradewind/execution/meeting-compaction-progress.js';
import type { CompactionProgress } from '../../../engine/shared/compaction/index.js';

/** Archive first, commit cleared records second, then expose the cleared live state. */
export async function resetMeetingHistory(nodeId: string, meeting: ActiveMeeting): Promise<void> {
  const progress: CompactionProgress = { type: 'compact-start', id: randomUUID(), operation: 'reset',
    reason: 'manual', startedAt: Date.now(), updatedAt: Date.now() };
  const signal = meeting.roundAbort?.signal ?? meeting.signal;
  publishMeetingCompaction(meeting.session, 'public', progress);
  try {
    signal.throwIfAborted();
    await fs.mkdir(meeting.compactArchiveDir, { recursive: true });
    await atomicWriteFile(path.join(meeting.compactArchiveDir, `${Date.now()}-${randomUUID()}-reset.json`),
      JSON.stringify({ publicMessages: meeting.session.publicMessages,
        chairMessages: meeting.session.chairMessages, round: meeting.session.round }));
    signal.throwIfAborted();
    await meeting.session.usageRecorder.clearPromptMeasurement();
    if (meeting.runDir) {
      const directory = getMeetingsDir(meeting.runDir);
      await fs.mkdir(directory, { recursive: true });
      signal.throwIfAborted();
      await atomicWriteFile(path.join(directory, getMeetingFileName(nodeId, meeting.session.round)), '[]', signal);
      await atomicWriteFile(path.join(meeting.runDir, `chair-context-${nodeId}.json`), '[]');
    }
    meeting.session.publicMessages = [];
    meeting.session.chairMessages = [];
    delete meeting.session.chairActiveContext;
    delete meeting.session.chairContextRawCount;
    delete meeting.session.chairContextPublicAnchor;
    publishMeetingCompaction(meeting.session, 'public', { ...progress, type: 'compact-done', updatedAt: Date.now() });
  } catch (error) {
    if (meeting.session.compactions?.public?.type === 'compact-start') {
      publishMeetingCompaction(meeting.session, 'public', { ...progress, type: 'compact-failed',
        updatedAt: Date.now(), aborted: signal.aborted, message: error instanceof Error ? error.message : String(error) });
    }
    throw error;
  }
}
