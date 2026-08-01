import type { BrowserDriver, BrowserDriverSession } from './browser-driver.js';
import type { BrowserActionResult, BrowserEvent, BrowserSnapshot } from './browser-protocol.js';

export interface DesktopBrowserTransport {
  request(action: 'open' | 'navigate' | 'inspect' | 'interact' | 'wait' | 'close', payload: Record<string, unknown>): Promise<BrowserSnapshot | undefined>;
  drainEvents(executionId: string): Promise<BrowserEvent[]>;
}

export class DesktopBrowserDriver implements BrowserDriver {
  readonly presentation = 'embedded-visible' as const;

  constructor(private readonly transport: DesktopBrowserTransport) {}

  async open(input: { executionId: string; engine: string; url: string }): Promise<{ session: BrowserDriverSession; snapshot: BrowserSnapshot }> {
    const snapshot = await this.request('open', { executionId: input.executionId, url: input.url });
    return { snapshot, session: new DesktopBrowserSession(this.transport, input.executionId) };
  }

  private async request(action: 'open' | 'navigate' | 'inspect' | 'interact' | 'wait', payload: Record<string, unknown>): Promise<BrowserSnapshot> {
    const capture = await this.transport.request(action, payload);
    if (!capture) throw new Error(`desktop browser ${action} returned no capture`);
    return capture;
  }
}

class DesktopBrowserSession implements BrowserDriverSession {
  constructor(private readonly transport: DesktopBrowserTransport, private readonly executionId: string) {}

  navigate(url: string): Promise<BrowserSnapshot> {
    return this.request('navigate', { executionId: this.executionId, url });
  }

  inspect(): Promise<BrowserSnapshot> {
    return this.request('inspect', { executionId: this.executionId });
  }

  async act(input: { action: 'click' | 'click_at' | 'type' | 'press'; targetId?: string; x?: number; y?: number; text?: string; key?: string }): Promise<BrowserActionResult> {
    const before = await this.request('inspect', { executionId: this.executionId });
    const snapshot = await this.request('interact', { executionId: this.executionId, ...input });
    return { snapshot, outcome: snapshot.url !== before.url ? 'navigated' : input.action === 'click' || input.action === 'click_at' ? 'unchanged' : 'completed' };
  }

  wait(ms: number): Promise<BrowserSnapshot> {
    return this.request('wait', { executionId: this.executionId, ms });
  }

  drainEvents(): Promise<BrowserEvent[]> {
    return this.transport.drainEvents(this.executionId);
  }

  async close(): Promise<void> {
    await this.transport.request('close', { executionId: this.executionId });
  }

  private async request(action: 'navigate' | 'inspect' | 'interact' | 'wait', payload: Record<string, unknown>): Promise<BrowserSnapshot> {
    const capture = await this.transport.request(action, payload);
    if (!capture) throw new Error(`desktop browser ${action} returned no capture`);
    return capture;
  }
}
