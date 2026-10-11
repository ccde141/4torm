import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicWriteFile } from '../../../engine/shared/atomic-io.js';
import { getMeetingFileName, getMeetingsDir } from '../../../engine/tradewind/foundation/archive-paths.js';
import type { ActiveMeeting } from '../../../engine/tradewind/nodes/meeting.js';

/** Archive first, commit cleared records second, then expose the cleared live state. */
export async function resetMeetingHistory(nodeId: string, meeting: ActiveMeeting): Promise<void> {
  await fs.mkdir(meeting.compactArchiveDir, { recursive: true });
  await atomicWriteFile(path.join(meeting.compactArchiveDir, `${Date.now()}-${randomUUID()}-reset.json`),
    JSON.stringify({ publicMessages: meeting.session.publicMessages,
      chairMessages: meeting.session.chairMessages, round: meeting.session.round }));
  await meeting.session.usageRecorder.clearPromptMeasurement();
  if (meeting.runDir) {
    const directory = getMeetingsDir(meeting.runDir);
    await fs.mkdir(directory, { recursive: true });
    await atomicWriteFile(path.join(directory, getMeetingFileName(nodeId, meeting.session.round)), '[]');
    await atomicWriteFile(path.join(meeting.runDir, `chair-context-${nodeId}.json`), '[]');
  }
  meeting.session.publicMessages = [];
  meeting.session.chairMessages = [];
  delete meeting.session.chairActiveContext;
  delete meeting.session.chairContextRawCount;
  delete meeting.session.chairContextPublicAnchor;
}
