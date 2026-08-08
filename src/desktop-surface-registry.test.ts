import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createSurfaceRegistry } = require('../electron/surface-registry.cjs') as {
  createSurfaceRegistry(deps: { WebContentsView: new (options: unknown) => unknown; getWindow: () => unknown }): {
    create(id: string, url: string): Promise<void>;
    inspect(id: string): Promise<{ frame: Buffer; title: string; url: string; text: string; targets: unknown[] }>;
    interact(id: string, input: unknown): Promise<{ frame: Buffer; title: string; url: string; text: string; targets: unknown[] }>;
    drainEvents(id: string): Promise<Array<{ source: string; type: string; detail?: string }>>;
    show(id: string, bounds: unknown, leaseId?: string): void;
    setInputEnabled(id: string, enabled: boolean): void;
    hide(id: string, leaseId?: string): void;
    close(id: string): void;
  };
};

function createRegistry() {
  let currentUrl = 'https://example.test';
  let windowOpenHandler: ((details: { url: string }) => { action: string }) | undefined;
  const views: Array<{ options: unknown; webContents: { loadURL(url: string): Promise<void>; close(): void; setWindowOpenHandler(handler: (details: { url: string }) => { action: string }): void; setIgnoreMouseEvents(enabled: boolean): void; on(event: string, listener: (input: { preventDefault(): void }) => void): void; capturePage(): Promise<{ toPNG(): Buffer }>; executeJavaScript(script?: string): Promise<unknown>; getTitle(): string; getURL(): string }; setBounds(bounds: unknown): void }> = [];
  const attached: unknown[] = [];
  const removed: unknown[] = [];
  const ignoredMouseEvents: boolean[] = [];
  const inputHandlers: Array<(input: { preventDefault(): void }) => void> = [];
  const registry = createSurfaceRegistry({
    WebContentsView: class {
      webContents = {
        loadURL: async (url: string) => { currentUrl = url; },
        close: () => undefined,
        setWindowOpenHandler: (handler: (details: { url: string }) => { action: string }) => { windowOpenHandler = handler; },
        setIgnoreMouseEvents: (enabled: boolean) => ignoredMouseEvents.push(enabled),
        on: (_event: string, listener: (input: { preventDefault(): void }) => void) => inputHandlers.push(listener),
        capturePage: async () => ({ toPNG: () => Buffer.from('frame') }),
        executeJavaScript: async (script?: string) => {
          if (script?.includes('const input =')) windowOpenHandler?.({ url: 'https://popup.example.test' });
          if (script?.includes('const events =')) return [];
          if (script?.includes('text: (document.body')) return { text: 'Surface content', targets: [{ id: 'target-0-1234567890', index: 0, role: 'button', name: 'Continue', visible: true, enabled: true }] };
          return undefined;
        },
        getTitle: () => 'Surface title',
        getURL: () => currentUrl,
      };
      constructor(public readonly options: unknown) { views.push(this); }
      setBounds() {}
    },
    getWindow: () => ({ contentView: { addChildView: (view: unknown) => attached.push(view), removeChildView: (view: unknown) => removed.push(view) } }),
  });
  return { registry, views, attached, removed, ignoredMouseEvents, inputHandlers };
}

test('desktop registry creates an isolated and unprivileged web surface', async () => {
  const { registry, views } = createRegistry();

  await registry.create('exec-a', 'https://example.test');

  assert.deepEqual(views[0]?.options, {
    webPreferences: { partition: '4torm-browser-exec-a', nodeIntegration: false, contextIsolation: true, sandbox: true },
  });
});

test('desktop registry attaches a created surface only when it is shown', async () => {
  const { registry, attached } = createRegistry();
  await registry.create('exec-a', 'https://example.test');

  registry.show('exec-a', { x: 10, y: 10, width: 500, height: 400 });

  assert.equal(attached.length, 1);
});

test('desktop registry ignores a late hide from an older view lease', async () => {
  const { registry, removed } = createRegistry();
  await registry.create('exec-a', 'https://example.test');

  registry.show('exec-a', { x: 10, y: 10, width: 500, height: 400 }, 'first-view');
  registry.show('exec-a', { x: 10, y: 10, width: 500, height: 400 }, 'second-view');
  registry.hide('exec-a', 'first-view');

  assert.equal(removed.length, 0);
  registry.hide('exec-a', 'second-view');
  assert.equal(removed.length, 1);
});

test('desktop registry gates native input while the agent controls the surface', async () => {
  const { registry, ignoredMouseEvents } = createRegistry();
  await registry.create('exec-a', 'https://example.test');

  registry.setInputEnabled('exec-a', false);
  registry.setInputEnabled('exec-a', true);

  assert.deepEqual(ignoredMouseEvents, [true, false]);
});

test('desktop registry blocks human keyboard input until control is transferred', async () => {
  const { registry, inputHandlers } = createRegistry();
  await registry.create('exec-a', 'https://example.test');

  let prevented = 0;
  inputHandlers[0]?.({ preventDefault: () => { prevented += 1; } });
  registry.setInputEnabled('exec-a', true);
  inputHandlers[0]?.({ preventDefault: () => { prevented += 1; } });

  assert.equal(prevented, 1);
});

test('desktop registry exposes the actual web contents as a browser capture', async () => {
  const { registry } = createRegistry();
  await registry.create('exec-a', 'https://example.test');

  const capture = await registry.inspect('exec-a');

  assert.deepEqual(capture, {
    frame: Buffer.from('frame'), title: 'Surface title', url: 'https://example.test', text: 'Surface content', targets: [{ id: 'target-0-1234567890', index: 0, role: 'button', name: 'Continue', visible: true, enabled: true }],
  });
});

test('desktop registry loads an agent popup into its existing surface', async () => {
  const { registry } = createRegistry();
  await registry.create('exec-a', 'https://example.test');

  const capture = await registry.interact('exec-a', { action: 'click', targetId: 'target-0-1234567890' });

  assert.equal(capture.url, 'https://popup.example.test');
  assert.deepEqual(await registry.drainEvents('exec-a'), [
    { source: 'agent', type: 'navigation', detail: 'https://popup.example.test' },
  ]);
});

test('desktop registry rejects unknown surfaces and closes attached content', async () => {
  const { registry, views, removed } = createRegistry();
  await registry.create('exec-a', 'https://example.test');
  registry.show('exec-a', { x: 0, y: 0, width: 1, height: 1 });

  assert.throws(() => registry.show('missing', { x: 0, y: 0, width: 1, height: 1 }), /surface not found/);
  registry.close('exec-a');
  registry.hide('exec-a');
  registry.close('exec-a');

  assert.equal(removed.length, 1);
  assert.equal(views.length, 1);
});

test('desktop bridge exposes bounded surface controls while the main process validates the caller', () => {
  const main = fs.readFileSync('electron/main.cjs', 'utf8');
  const registrySource = fs.readFileSync('electron/surface-registry.cjs', 'utf8');
  const preload = fs.readFileSync('electron/preload.cjs', 'utf8');

  assert.match(main, /ipcMain\.handle\('execution-surface:show'/);
  assert.match(main, /event\.sender !== mainWindow\?\.webContents/);
  assert.match(main, /executionSurfaceRegistry\.dispose\(\)/);
  assert.match(main, /execution-surface:set-input-enabled/);
  assert.match(main, /typeof input\.enabled !== 'boolean'/);
  assert.match(main, /startDesktopBrowserBridge\(\)/);
  assert.match(main, /app\.requestSingleInstanceLock\(\)/);
  assert.match(main, /FOURTORM_DESKTOP_BRIDGE/);
  assert.match(main, /spawn\(nodeRuntime, \[tsxCli, 'src\/index\.ts'\]/);
  assert.match(main, /shell:\s*false/);
  assert.match(registrySource, /sendInputEvent/);
  assert.match(main, /FOURTORM_DESKTOP_BRIDGE/);
  assert.match(main, /FOURTORM_DESKTOP_BROWSER_TOKEN/);
  assert.match(preload, /executionSurface:\s*\{/);
  assert.match(preload, /execution-surface:show/);
  assert.match(preload, /execution-surface:set-input-enabled/);
  assert.doesNotMatch(preload, /execution-surface:create/);
  assert.doesNotMatch(preload, /FOURTORM_DESKTOP_BROWSER_TOKEN/);
});

test('native observation mounts the real surface for both control modes', () => {
  const view = fs.readFileSync('src/components/chat/NativeObservationView.tsx', 'utf8');
  const observationHook = fs.readFileSync('src/components/chat/useVisualObservation.ts', 'utf8');

  assert.match(view, /presentation !== 'hidden'/);
  assert.match(view, /presentation !== 'external-visible'/);
  assert.match(view, /setInputEnabled\(observationId, humanControlled\)/);
  assert.match(view, /window\.desktop \? null/);
  assert.match(view, /useVisualObservation/);
  assert.match(view, /refreshActiveObservation: true/);
  assert.match(view, /isActiveObservationStatus\(currentItem\.status\)/);
  assert.match(observationHook, /readVisualObservation/);
  assert.match(observationHook, /requestVisualObservationRefresh/);
  assert.match(view, /surfaceReady/);
  assert.match(view, /surfacePhase/);
  assert.match(view, /打开中/);
  assert.match(view, /正在打开浏览器/);
  assert.match(view, /<div ref={stageRef} style={stage}>/);
  assert.doesNotMatch(view, /error \? <div style={errorStyle}>/);
  assert.match(view, /isTransientSurfaceError/);
  assert.match(observationHook, /MAX_READ_FAILURES = 3/);
  assert.match(view, /rect\.width < 1 \|\| rect\.height < 1/);
  assert.doesNotMatch(view, /nativeSurface, revision/);
  assert.doesNotMatch(view, /humanControlled \? null : <img/);
});
