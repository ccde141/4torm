import { randomUUID } from 'node:crypto';
import net from 'node:net';
import type { BrowserEvent, BrowserSnapshot } from './browser-protocol.js';
import type { DesktopBrowserTransport } from './desktop-browser-driver.js';

type BridgeAction = 'open' | 'navigate' | 'inspect' | 'interact' | 'wait' | 'events' | 'close';
type BridgeResponse = { id: string | null; ok: boolean; result?: unknown; error?: unknown };

export class DesktopBrowserTransportClient implements DesktopBrowserTransport {
  constructor(private readonly config: { endpoint: string; token: string; timeoutMs?: number }) {}

  async request(action: BridgeAction, payload: Record<string, unknown>): Promise<BrowserSnapshot | undefined> {
    const response = await this.send(action, payload);
    if (action === 'close') return undefined;
    return decodeCapture(response.result);
  }

  async drainEvents(executionId: string): Promise<BrowserEvent[]> {
    const response = await this.send('events', { executionId });
    if (!Array.isArray(response.result)) throw new Error('desktop browser bridge returned invalid events');
    return response.result.map(value => decodeEvent(value));
  }

  private async send(action: BridgeAction, payload: Record<string, unknown>): Promise<BridgeResponse> {
    const id = randomUUID();
    const response = await requestBridge({
      endpoint: this.config.endpoint,
      timeoutMs: this.config.timeoutMs ?? 20_000,
      body: JSON.stringify({ id, token: this.config.token, action, payload }) + '\n',
    });
    if (response.id !== id) throw new Error('desktop browser bridge request id does not match');
    if (!response.ok) throw new Error(typeof response.error === 'string' ? response.error : 'desktop browser bridge request failed');
    return response;
  }
}

function requestBridge(input: { endpoint: string; timeoutMs: number; body: string }): Promise<BridgeResponse> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(input.endpoint);
    let received = '';
    let settled = false;
    const settle = (error?: Error, response?: BridgeResponse) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error);
      else resolve(response!);
    };
    socket.setEncoding('utf8');
    socket.setTimeout(input.timeoutMs, () => settle(new Error('desktop browser bridge request timed out')));
    socket.once('connect', () => socket.write(input.body));
    socket.on('data', chunk => {
      received += chunk;
      const newline = received.indexOf('\n');
      if (newline < 0) return;
      try { settle(undefined, parseResponse(received.slice(0, newline))); }
      catch (error) { settle(error as Error); }
    });
    socket.once('error', error => settle(error));
    socket.once('close', () => { if (!settled) settle(new Error('desktop browser bridge disconnected before responding')); });
  });
}

function parseResponse(value: string): BridgeResponse {
  let parsed: unknown;
  try { parsed = JSON.parse(value); }
  catch { throw new Error('desktop browser bridge returned invalid JSON'); }
  if (!parsed || typeof parsed !== 'object' || typeof (parsed as BridgeResponse).ok !== 'boolean') throw new Error('desktop browser bridge returned an invalid response');
  return parsed as BridgeResponse;
}

function decodeCapture(value: unknown): BrowserSnapshot {
  if (!value || typeof value !== 'object') throw new Error('desktop browser bridge returned no capture');
  const capture = value as { frame?: unknown; title?: unknown; url?: unknown; text?: unknown; targets?: unknown };
  if (typeof capture.frame !== 'string' || typeof capture.title !== 'string' || typeof capture.url !== 'string' || typeof capture.text !== 'string' || !Array.isArray(capture.targets)) {
    throw new Error('desktop browser bridge returned an invalid capture');
  }
  const targets = capture.targets.map(target => {
    if (!target || typeof target !== 'object' || typeof (target as { id?: unknown }).id !== 'string' || typeof (target as { role?: unknown }).role !== 'string' || typeof (target as { name?: unknown }).name !== 'string') {
      throw new Error('desktop browser bridge returned invalid capture elements');
    }
    return target as BrowserSnapshot['targets'][number];
  });
  return { frame: Buffer.from(capture.frame, 'base64'), title: capture.title, url: capture.url, text: capture.text, targets };
}

function decodeEvent(value: unknown): BrowserEvent {
  if (!value || typeof value !== 'object') throw new Error('desktop browser bridge returned invalid event');
  const event = value as Partial<BrowserEvent>;
  if (!['agent', 'human', 'page'].includes(event.source ?? '') || !['navigation', 'click', 'input', 'change', 'focus', 'mutation'].includes(event.type ?? '')) {
    throw new Error('desktop browser bridge returned invalid event');
  }
  return { source: event.source!, type: event.type!, ...(typeof event.detail === 'string' ? { detail: event.detail } : {}) };
}
