import type { BrowserEngine } from './browser-engine.js';
import type { BrowserActionResult, BrowserEvent, BrowserPresentation, BrowserSnapshot } from './browser-protocol.js';

export interface BrowserDriverSession {
  navigate(url: string): Promise<BrowserSnapshot>;
  inspect(): Promise<BrowserSnapshot>;
  act(input: { action: 'click' | 'click_at' | 'type' | 'press'; targetId?: string; x?: number; y?: number; text?: string; key?: string }): Promise<BrowserActionResult>;
  wait(ms: number): Promise<BrowserSnapshot>;
  drainEvents(): Promise<BrowserEvent[]>;
  close(): Promise<void>;
}

export interface BrowserDriver {
  presentation: BrowserPresentation;
  open(input: { executionId: string; engine: BrowserEngine; url: string }): Promise<{ session: BrowserDriverSession; snapshot: BrowserSnapshot }>;
}
