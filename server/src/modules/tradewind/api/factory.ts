import type { FeatureModule } from '../../../engine/collaboration/contracts.js';
import { createTradewindRuntimeSource } from '../runtime/execution-adapter.js';
import { createTradewindModule } from './module.js';
import { createTradewindCommands } from '../runtime/control-adapter.js';
import { createTradewindDesignPort } from '../runtime/design-adapter.js';
import { createTradewindWorkflowAdmin } from '../runtime/workflow-admin.js';
import { createTradewindMeetingCommands } from '../runtime/meeting-control-adapter.js';
import { createTradewindWorkflowStore } from '../runtime/workflow-store.js';
import { createTradewindWorkflowWrites } from '../runtime/workflow-writes.js';
import { createTradewindRecordPort } from '../runtime/record-adapter.js';
import { createTradewindReadPort } from '../runtime/read-adapter.js';
import { createTradewindEventPort } from '../runtime/event-adapter.js';

export interface TradewindFeatureOptions { dataDir: string }
export interface TradewindFeature { module: FeatureModule }

export function createTradewindFeature(options: TradewindFeatureOptions): TradewindFeature {
  const store = createTradewindWorkflowStore(options.dataDir);
  const writes = createTradewindWorkflowWrites(store);
  return { module: createTradewindModule({
    source: createTradewindRuntimeSource(options.dataDir, store),
    commands: createTradewindCommands(options.dataDir, store),
    design: createTradewindDesignPort(options.dataDir, store, writes),
    workflowAdmin: createTradewindWorkflowAdmin(options.dataDir, undefined, store, writes),
    meetingCommands: createTradewindMeetingCommands(),
    records: createTradewindRecordPort(options.dataDir),
    reads: createTradewindReadPort(options.dataDir),
    events: createTradewindEventPort(),
  }) };
}
