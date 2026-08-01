import { type BrowserEngine } from './browser-engine.js';
import type { ObservationScope } from './execution-observation-contract.js';
import { browserRuntime } from './browser-runtime.js';

/**
 * HTTP-facing browser execution capability. Driver choice belongs to BrowserRuntime;
 * callers must not infer Playwright or Electron behavior from this adapter.
 */
export class BrowserExecutionProducer {
  async open(input: { scope: ObservationScope; ownerId: string; surfaceId?: string; url: string; engine?: BrowserEngine }): Promise<string> {
    return browserRuntime.open(input);
  }

  async takeControl(id: string, scope: ObservationScope, ownerId: string): Promise<void> {
    return browserRuntime.takeControl(id, scope, ownerId);
  }

  async returnControl(id: string, scope: ObservationScope, ownerId: string): Promise<void> {
    return browserRuntime.returnControl(id, scope, ownerId);
  }

  async refresh(id: string, scope: ObservationScope, ownerId: string): Promise<void> {
    return browserRuntime.refresh(id, scope, ownerId);
  }

  async close(id: string, scope?: ObservationScope, ownerId?: string): Promise<void> {
    return browserRuntime.close(id, scope, ownerId);
  }
}

export const browserExecutionProducer = new BrowserExecutionProducer();
