import { browserExecutionCapability } from './browser-execution-capability.js';
import { ExecutionCapabilityRegistry } from './execution-capability-registry.js';

/** Only reviewed, bundled capabilities are registered here; this is not an arbitrary plugin loader. */
export const executionCapabilities = new ExecutionCapabilityRegistry();
executionCapabilities.register(browserExecutionCapability);
