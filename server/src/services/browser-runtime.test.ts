import assert from 'node:assert/strict';
import test from 'node:test';
import { BrowserRuntime } from './browser-runtime.js';
import { ExecutionObserver } from './execution-observer.js';
import { VisualArtifactStore } from './visual-artifact-store.js';
import { targetIdFor } from './browser-protocol.js';

const continueTargetId = targetIdFor({ index: 0, role: 'button', name: 'Continue' });

function createRuntime() {
  const clicks: number[] = [];
  const locatorSelectors: string[] = [];
  const gotoUrls: string[] = [];
  let launches = 0;
  let currentUrl = '';
  const observer = new ExecutionObserver(() => 100);
  const runtime = new BrowserRuntime({
    observer,
    artifacts: new VisualArtifactStore(),
    launch: async () => {
      launches++;
      return {
        newContext: async () => ({
          newPage: async () => ({
            goto: async (url: string) => { gotoUrls.push(url); currentUrl = url; },
            screenshot: async () => Buffer.from('frame'),
            title: async () => 'Test page',
            url: () => currentUrl,
            context: () => ({ close: async () => undefined }),
            evaluate: async () => ({ text: 'Welcome', elements: [{ index: 0, role: 'button', name: 'Continue', href: undefined, bounds: { x: 10, y: 10, width: 80, height: 30 }, visible: true, enabled: true }] }),
            locator: (selector: string) => {
              locatorSelectors.push(selector);
              return { nth: (index: number) => ({ click: async () => { clicks.push(index); }, fill: async () => undefined, press: async () => undefined }) };
            },
            waitForTimeout: async () => undefined,
          }),
          close: async () => undefined,
        }),
        close: async () => undefined,
      };
    },
    resolveLaunch: async () => ({}),
  });
  return { runtime, clicks, locatorSelectors, gotoUrls, getLaunches: () => launches, observer };
}

const owner = { scope: 'conversation' as const, ownerId: 'session-a' };

test('opens a browser and returns a compact snapshot with stable target references', async () => {
  const { runtime } = createRuntime();
  const result = await runtime.execute({ ...owner, action: 'open', url: 'https://example.test' });

  assert.match(result, /revision: 1/);
  assert.match(result, new RegExp(`\\[${continueTargetId}\\] button: Continue`));
  assert.match(result, /bounds=10,10,80x30/);
});

test('reuses the active browser and observation when open navigates again', async () => {
  const { runtime, gotoUrls, getLaunches, observer } = createRuntime();
  await runtime.execute({ ...owner, action: 'open', url: 'https://example.test/first' });
  const id = observer.listActive(owner.scope, owner.ownerId)[0]?.id;

  const result = await runtime.execute({ ...owner, action: 'open', url: 'https://example.test/second' });

  assert.equal(observer.listActive(owner.scope, owner.ownerId)[0]?.id, id);
  assert.equal(getLaunches(), 1);
  assert.deepEqual(gotoUrls, ['https://example.test/first', 'https://example.test/second']);
  assert.match(result, /revision: 2/);
});

test('keeps browser surfaces separate inside the same conversation owner', async () => {
  const { runtime, getLaunches, observer } = createRuntime();

  await runtime.execute({ ...owner, surfaceId: 'research', action: 'open', url: 'https://example.test/research' });
  await runtime.execute({ ...owner, surfaceId: 'review', action: 'open', url: 'https://example.test/review' });

  assert.equal(observer.listActive(owner.scope, owner.ownerId).length, 2);
  assert.equal(getLaunches(), 2);
});

test('rejects a browser action when the page revision is stale', async () => {
  const { runtime, clicks } = createRuntime();
  await runtime.execute({ ...owner, action: 'open', url: 'https://example.test' });

  await assert.rejects(
    () => runtime.execute({ ...owner, action: 'click', targetId: continueTargetId, revision: 0 }),
    /stale browser revision/,
  );
  assert.deepEqual(clicks, []);
});

test('aborts an in-flight inspect without publishing a later revision', async () => {
  const observer = new ExecutionObserver(() => 100);
  let releaseInspect!: () => void;
  const blockedInspect = new Promise<never>(resolve => { releaseInspect = resolve as never; });
  const snapshot = { frame: Buffer.from('frame'), title: 'Slow page', url: 'https://slow.test', text: '', targets: [] };
  const runtime = new BrowserRuntime({
    observer,
    driver: {
      open: async () => ({
        snapshot,
        session: {
          navigate: async () => snapshot,
          inspect: async () => blockedInspect,
          act: async () => ({ snapshot, outcome: 'completed' as const }),
          wait: async () => snapshot,
          drainEvents: async () => [],
          close: async () => undefined,
        },
      }),
    },
  });
  await runtime.execute({ ...owner, action: 'open', url: 'https://slow.test' });
  const controller = new AbortController();

  const pending = runtime.execute({ ...owner, action: 'inspect', signal: controller.signal });
  controller.abort();

  await assert.rejects(() => pending, /browser action aborted/);
  assert.equal(observer.listActive(owner.scope, owner.ownerId)[0]?.viewerState?.revision, 1);
  releaseInspect();
});

test('resolves browser targets from the visible interactive element sequence', async () => {
  const { runtime, clicks, locatorSelectors } = createRuntime();
  await runtime.execute({ ...owner, action: 'open', url: 'https://example.test' });

  await runtime.execute({ ...owner, action: 'click', targetId: continueTargetId, revision: 1 });

  assert.deepEqual(clicks, [0]);
  assert.equal(locatorSelectors.at(-1), 'a:visible,button:visible,input:visible,textarea:visible,select:visible,[role="button"]:visible,[contenteditable="true"]:visible');
});

test('does not let an agent operate a browser while a human controls it', async () => {
  const { runtime, observer } = createRuntime();
  await runtime.execute({ ...owner, action: 'open', url: 'https://example.test' });
  await runtime.takeControl(observer.listActive(owner.scope, owner.ownerId)[0].id, owner.scope, owner.ownerId);

  await assert.rejects(
    () => runtime.execute({ ...owner, action: 'inspect' }),
    /under human control/,
  );
});

test('records a human page change and rejects the agent until it inspects again', async () => {
  const observer = new ExecutionObserver(() => 100);
  const snapshot = {
    frame: Buffer.from('frame'), title: 'Shared page', url: 'https://shared.test', text: '',
    targets: [{ id: continueTargetId, index: 0, role: 'button', name: 'Continue', visible: true, enabled: true }],
  };
  const events = [{ source: 'human' as const, type: 'input' as const, detail: 'input' }];
  const runtime = new BrowserRuntime({
    observer,
    driver: {
      presentation: 'embedded-visible',
      open: async () => ({
        snapshot,
        session: {
          navigate: async () => snapshot,
          inspect: async () => snapshot,
          act: async () => ({ snapshot, outcome: 'completed' as const }),
          wait: async () => snapshot,
          drainEvents: async () => events.splice(0),
          close: async () => undefined,
        },
      }),
    },
  });
  await runtime.execute({ ...owner, action: 'open', url: 'https://shared.test' });

  await assert.rejects(
    () => runtime.execute({ ...owner, action: 'click', targetId: continueTargetId, revision: 1 }),
    /changed outside agent control/,
  );

  const item = observer.listActive(owner.scope, owner.ownerId)[0];
  assert.equal(item?.viewerState?.revision, 2);
  assert.match(item?.viewerState?.summary ?? '', /Human input/);
});

test('does not invalidate an agent action for background page mutations', async () => {
  const observer = new ExecutionObserver(() => 100);
  const snapshot = { frame: Buffer.from('frame'), title: 'Animated page', url: 'https://animated.test', text: '', targets: [] };
  const events = [{ source: 'page' as const, type: 'mutation' as const }];
  let actions = 0;
  const runtime = new BrowserRuntime({
    observer,
    driver: {
      open: async () => ({
        snapshot,
        session: {
          navigate: async () => snapshot,
          inspect: async () => snapshot,
          act: async () => { actions += 1; return { snapshot, outcome: 'completed' as const }; },
          wait: async () => snapshot,
          drainEvents: async () => events.splice(0),
          close: async () => undefined,
        },
      }),
    },
  });
  await runtime.execute({ ...owner, action: 'open', url: 'https://animated.test' });

  await runtime.execute({ ...owner, action: 'press', key: 'Enter', revision: 1 });

  assert.equal(actions, 1);
  assert.equal(observer.listActive(owner.scope, owner.ownerId)[0]?.viewerState?.revision, 2);
});

test('existing-session open also requires inspect after a human page change', async () => {
  const observer = new ExecutionObserver(() => 100);
  const snapshot = { frame: Buffer.from('frame'), title: 'Shared page', url: 'https://shared.test', text: '', targets: [] };
  const events = [{ source: 'human' as const, type: 'click' as const, detail: 'link' }];
  const runtime = new BrowserRuntime({
    observer,
    driver: {
      presentation: 'embedded-visible',
      open: async () => ({
        snapshot,
        session: {
          navigate: async () => snapshot,
          inspect: async () => snapshot,
          act: async () => ({ snapshot, outcome: 'completed' as const }),
          wait: async () => snapshot,
          drainEvents: async () => events.splice(0),
          close: async () => undefined,
        },
      }),
    },
  });
  await runtime.execute({ ...owner, action: 'open', url: 'https://shared.test' });

  await assert.rejects(
    () => runtime.execute({ ...owner, action: 'open', url: 'https://shared.test/next' }),
    /changed outside agent control/,
  );
});

test('closes a human-controlled browser as cancelled instead of leaving it waiting', async () => {
  const { runtime, observer } = createRuntime();
  await runtime.execute({ ...owner, action: 'open', url: 'https://example.test' });
  await runtime.takeControl(observer.listActive(owner.scope, owner.ownerId)[0].id, owner.scope, owner.ownerId);
  await runtime.close(observer.listActive(owner.scope, owner.ownerId)[0].id, owner.scope, owner.ownerId);

  assert.deepEqual(observer.listActive(owner.scope, owner.ownerId), []);
});

test('coalesces overlapping browser close requests and accepts a late repeat', async () => {
  const observer = new ExecutionObserver(() => 100);
  const snapshot = { frame: Buffer.from('frame'), title: 'Closing page', url: 'https://closing.test', text: '', targets: [] };
  let closeCalls = 0;
  const runtime = new BrowserRuntime({
    observer,
    driver: {
      open: async () => ({
        snapshot,
        session: {
          navigate: async () => snapshot,
          inspect: async () => snapshot,
          act: async () => ({ snapshot, outcome: 'completed' as const }),
          wait: async () => snapshot,
          drainEvents: async () => [],
          close: async () => { closeCalls += 1; },
        },
      }),
    },
  });
  await runtime.execute({ ...owner, action: 'open', url: 'https://closing.test' });
  const id = observer.listActive(owner.scope, owner.ownerId)[0]!.id;

  await Promise.all([runtime.close(id, owner.scope, owner.ownerId), runtime.close(id, owner.scope, owner.ownerId)]);
  await runtime.close(id, owner.scope, owner.ownerId);

  assert.equal(closeCalls, 1);
  assert.deepEqual(observer.listActive(owner.scope, owner.ownerId), []);
});

test('does not expose browser close as an agent tool action', async () => {
  const { runtime } = createRuntime();
  await runtime.execute({ ...owner, action: 'open', url: 'https://example.test' });

  await assert.rejects(() => runtime.execute({ ...owner, action: 'close' }), /unsupported browser action/);
});

test('the UI can close a browser surface and reopen a fresh execution on the same surface', async () => {
  const { runtime, observer, getLaunches } = createRuntime();
  await runtime.execute({ ...owner, action: 'open', url: 'https://example.test/first' });
  const firstId = observer.listActive(owner.scope, owner.ownerId)[0]?.id;

  await runtime.close(firstId!, owner.scope, owner.ownerId);
  await runtime.execute({ ...owner, action: 'open', url: 'https://example.test/second' });
  const secondId = observer.listActive(owner.scope, owner.ownerId)[0]?.id;

  assert.notEqual(secondId, firstId);
  assert.equal(getLaunches(), 2);
});

test('uses an injected browser driver instead of launching Playwright directly', async () => {
  const observer = new ExecutionObserver(() => 100);
  const openInputs: unknown[] = [];
  const snapshot = { frame: Buffer.from('frame'), title: 'Driver page', url: 'https://driver.test', text: 'Driver content', targets: [] };
  const runtime = new BrowserRuntime({
    observer,
    driver: {
      open: async (input: unknown) => {
        openInputs.push(input);
        return {
          snapshot,
          session: {
            navigate: async () => snapshot,
            inspect: async () => snapshot,
            act: async () => ({ snapshot, outcome: 'completed' as const }),
            wait: async () => snapshot,
            close: async () => undefined,
          },
        };
      },
    },
    launch: async () => { throw new Error('legacy Playwright launch should not run'); },
    resolveLaunch: async () => ({}),
  } as never);

  const result = await runtime.execute({ ...owner, action: 'open', url: 'https://driver.test' });

  assert.deepEqual(openInputs.map(input => {
    const value = input as { engine: string; url: string };
    return { engine: value.engine, url: value.url };
  }), [{ engine: 'system-edge', url: 'https://driver.test' }]);
  assert.match(result, /title: Driver page/);
});

test('publishes a native presentation only when the injected driver explicitly supports it', async () => {
  const observer = new ExecutionObserver(() => 100);
  const snapshot = { frame: Buffer.from('frame'), title: 'Desktop page', url: 'https://desktop.test', text: '', targets: [] };
  const runtime = new BrowserRuntime({
    observer,
    driver: {
      presentation: 'embedded-visible',
      open: async () => ({ snapshot, session: { navigate: async () => snapshot, inspect: async () => snapshot, act: async () => ({ snapshot, outcome: 'completed' as const }), wait: async () => snapshot, close: async () => undefined } }),
    },
  } as never);

  await runtime.execute({ ...owner, action: 'open', url: 'https://desktop.test' });

  assert.equal(observer.listActive(owner.scope, owner.ownerId)[0]?.viewerState?.presentation, 'embedded-visible');
  assert.match(observer.listActive(owner.scope, owner.ownerId)[0]?.command ?? '', /^4torm Browser:/);
});
