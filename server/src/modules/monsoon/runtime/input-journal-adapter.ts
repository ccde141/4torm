import { validateHumanInput } from '../../../engine/conversation/input-inbox.js';
import { readInputJournal } from '../../../engine/conversation/input-journal.js';
import type {
  MonsoonInputJournalPort, MonsoonInputOwner,
} from '../application/input-service.js';

/** Legacy journal persistence remains the implementation of the Monsoon input port. */
export function createMonsoonInputJournalPort(dataDir: string): MonsoonInputJournalPort {
  return {
    validate: validateHumanInput,
    read: (owner: MonsoonInputOwner) => readInputJournal(dataDir, owner),
  };
}
