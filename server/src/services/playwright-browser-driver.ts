import { resolveBrowserLaunch, type BrowserEngine } from './browser-engine.js';
import type { BrowserDriver, BrowserDriverSession } from './browser-driver.js';
import { parseTargetId, targetIdFor, type BrowserActionResult, type BrowserEvent, type BrowserSnapshot, type BrowserTarget } from './browser-protocol.js';

type BrowserLocator = { nth(index: number): { click(): Promise<void>; fill(text: string): Promise<void>; press(key: string): Promise<void> } };
type BrowserPage = {
  goto(url: string, options: { waitUntil: 'domcontentloaded'; timeout: number }): Promise<unknown>;
  screenshot(options: { type: 'png' }): Promise<Buffer>;
  title(): Promise<string>;
  url(): string;
  evaluate<T>(pageFunction: () => T): Promise<T>;
  locator(selector: string): BrowserLocator;
  mouse?: { click(x: number, y: number): Promise<void> };
  keyboard?: { press(key: string): Promise<void> };
  waitForTimeout(ms: number): Promise<void>;
};
type BrowserContext = { newPage(): Promise<BrowserPage>; close(): Promise<void> };
type BrowserHandle = { newContext(options: { viewport: { width: number; height: number } }): Promise<BrowserContext>; close(): Promise<void> };
export type BrowserLauncher = (options: { headless: true; executablePath?: string }) => Promise<BrowserHandle>;
export type BrowserLaunchResolver = (engine: BrowserEngine) => Promise<{ executablePath?: string }>;

export class PlaywrightBrowserDriver implements BrowserDriver {
  readonly presentation = 'hidden' as const;

  private readonly launch: BrowserLauncher;
  private readonly resolveLaunch: BrowserLaunchResolver;

  constructor(deps: { launch?: BrowserLauncher; resolveLaunch?: BrowserLaunchResolver } = {}) {
    this.launch = deps.launch ?? launchPlaywright;
    this.resolveLaunch = deps.resolveLaunch ?? resolveBrowserLaunch;
  }

  async open(input: { executionId: string; engine: BrowserEngine; url: string }): Promise<{ session: BrowserDriverSession; snapshot: BrowserSnapshot }> {
    const browser = await this.launch({ headless: true, ...await this.resolveLaunch(input.engine) });
    let context: BrowserContext | undefined;
    try {
      context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const page = await context.newPage();
      const session = new PlaywrightBrowserSession(browser, context, page);
      const snapshot = await session.navigate(input.url);
      return { session, snapshot };
    } catch (error) {
      await context?.close().catch(() => {});
      await browser.close().catch(() => {});
      throw error;
    }
  }
}

class PlaywrightBrowserSession implements BrowserDriverSession {
  private targets = new Map<string, BrowserTarget>();

  constructor(private readonly browser: BrowserHandle, private readonly context: BrowserContext, private readonly page: BrowserPage) {}

  async navigate(url: string): Promise<BrowserSnapshot> {
    await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15_000 });
    return this.capture();
  }

  inspect(): Promise<BrowserSnapshot> {
    return this.capture();
  }

  async act(input: { action: 'click' | 'click_at' | 'type' | 'press'; targetId?: string; x?: number; y?: number; text?: string; key?: string }): Promise<BrowserActionResult> {
    const before = this.page.url();
    if (input.action === 'click_at') {
      if (!this.page.mouse || !Number.isFinite(input.x) || !Number.isFinite(input.y)) throw new Error('browser click_at requires x and y');
      await this.page.mouse.click(input.x!, input.y!);
    } else if (input.action === 'press' && !input.targetId) {
      if (!this.page.keyboard || !input.key) throw new Error('browser press requires key');
      await this.page.keyboard.press(input.key);
    } else {
      const target = this.requireTarget(input.targetId);
      const locator = this.page.locator(visibleInteractiveSelector).nth(target.index);
      if (input.action === 'click') await locator.click();
      if (input.action === 'type') {
        if (typeof input.text !== 'string') throw new Error('browser type requires text');
        await locator.fill(input.text);
      }
      if (input.action === 'press') {
        if (!input.key) throw new Error('browser press requires key');
        await locator.press(input.key);
      }
    }
    const snapshot = await this.capture();
    return { snapshot, outcome: snapshot.url !== before ? 'navigated' : input.action === 'click' || input.action === 'click_at' ? 'unchanged' : 'completed' };
  }

  async wait(ms: number): Promise<BrowserSnapshot> {
    await this.page.waitForTimeout(ms);
    return this.capture();
  }

  async drainEvents(): Promise<BrowserEvent[]> {
    return [];
  }

  async close(): Promise<void> {
    await this.context.close().catch(() => {});
    await this.browser.close().catch(() => {});
  }

  private async capture(): Promise<BrowserSnapshot> {
    const snapshot = await capturePage(this.page);
    this.targets = new Map(snapshot.targets.map(target => [target.id, target]));
    return snapshot;
  }

  private requireTarget(value: string | undefined): BrowserTarget {
    if (!value) throw new Error('browser action requires targetId');
    const parsed = parseTargetId(value);
    const target = this.targets.get(value);
    if (!target || target.index !== parsed.index || targetIdFor(target) !== value) throw new Error('browser targetId is stale');
    return target;
  }
}

const interactiveSelector = 'a,button,input,textarea,select,[role="button"],[contenteditable="true"]';
const visibleInteractiveSelector = interactiveSelector.split(',').map(selector => `${selector}:visible`).join(',');

async function launchPlaywright(options: { headless: true; executablePath?: string }): Promise<BrowserHandle> {
  const { chromium } = await import('playwright');
  return chromium.launch(options) as unknown as BrowserHandle;
}

async function capturePage(page: BrowserPage): Promise<BrowserSnapshot> {
  const frame = await page.screenshot({ type: 'png' });
  const snapshot = await page.evaluate(() => ({
    text: (document.body?.innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 1600),
    elements: [...document.querySelectorAll('a,button,input,textarea,select,[role="button"],[contenteditable="true"]')]
      .filter((element) => (element as HTMLElement).offsetParent !== null)
      .slice(0, 24)
      .map((element, index) => ({
        index,
        role: element.getAttribute('role') || element.tagName.toLowerCase(),
        name: (element.getAttribute('aria-label') || (element as HTMLInputElement).placeholder || element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120),
        href: element instanceof HTMLAnchorElement ? element.href : undefined,
        bounds: (() => { const rect = (element as HTMLElement).getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }; })(),
        visible: true,
        enabled: !(element as HTMLButtonElement).disabled,
      })),
  }));
  return {
    frame,
    title: await page.title().catch(() => ''),
    url: page.url(),
    text: snapshot.text,
    targets: snapshot.elements.map(element => ({ ...element, id: targetIdFor(element) })),
  };
}
