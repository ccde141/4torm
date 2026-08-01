import { browserExecutionProducer } from './browser-execution-producer.js';
import { executeBrowserTool } from './browser-tool-adapter.js';
import type { ExecutionCapabilityProvider } from './execution-capability-registry.js';

/** Browser is bundled, but participates through the same provider seam as future capabilities. */
export const browserExecutionCapability: ExecutionCapabilityProvider = {
  id: 'browser',
  tool: {
    name: 'browser',
    execute: input => executeBrowserTool(input),
  },
  surface: {
    viewer: 'browser',
    control: (input, next) => next === 'human'
      ? browserExecutionProducer.takeControl(input.id, input.scope, input.ownerId)
      : browserExecutionProducer.returnControl(input.id, input.scope, input.ownerId),
    refresh: input => browserExecutionProducer.refresh(input.id, input.scope, input.ownerId),
    close: input => browserExecutionProducer.close(input.id, input.scope, input.ownerId),
  },
};
