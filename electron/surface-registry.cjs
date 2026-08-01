'use strict';

function createSurfaceRegistry({ WebContentsView, getWindow }) {
  const surfaces = new Map();

  return {
    async create(id, url) {
      if (surfaces.has(id)) throw new Error('surface already exists');
      assertUrl(url);
      const view = new WebContentsView({
        webPreferences: {
          partition: `4torm-browser-${id}`,
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
        },
      });
      const surface = { view, attached: false, leaseId: undefined, inputEnabled: false, agentAction: false, events: [], pendingNavigation: undefined, pendingNavigationUrl: undefined };
      configureRemoteContent(view.webContents, surface);
      try {
        await view.webContents.loadURL(url);
        await installEventMonitor(view.webContents);
        surfaces.set(id, surface);
      } catch (error) {
        view.webContents.close();
        throw error;
      }
    },
    show(id, bounds, leaseId) {
      const surface = requireSurface(surfaces, id);
      const window = getWindow();
      if (!window) throw new Error('desktop window is not available');
      if (leaseId) surface.leaseId = leaseId;
      surface.view.webContents.setIgnoreMouseEvents?.(!surface.inputEnabled);
      if (!surface.attached) {
        window.contentView.addChildView(surface.view);
        surface.attached = true;
      }
      surface.view.setBounds(normalizeBounds(bounds));
    },
    setInputEnabled(id, enabled) {
      const surface = requireSurface(surfaces, id);
      surface.inputEnabled = Boolean(enabled);
      surface.view.webContents.setIgnoreMouseEvents?.(!surface.inputEnabled);
    },
    async inspect(id) {
      return captureSurface(requireSurface(surfaces, id).view.webContents);
    },
    async navigate(id, url) {
      assertUrl(url);
      const surface = requireSurface(surfaces, id);
      const contents = surface.view.webContents;
      await withAgentAction(contents, surface, async () => {
        await contents.loadURL(url);
        await installEventMonitor(contents);
      });
      surface.events.push({ source: 'agent', type: 'navigation', detail: contents.getURL() });
      return captureSurface(contents);
    },
    async interact(id, input) {
      const surface = requireSurface(surfaces, id);
      const contents = surface.view.webContents;
      await withAgentAction(contents, surface, async () => {
        if (input?.action === 'click_at' && typeof contents.sendInputEvent === 'function') {
          contents.focus?.();
          contents.sendInputEvent({ type: 'mouseDown', x: Math.round(input.x), y: Math.round(input.y), button: 'left', clickCount: 1 });
          contents.sendInputEvent({ type: 'mouseUp', x: Math.round(input.x), y: Math.round(input.y), button: 'left', clickCount: 1 });
          return;
        }
        if (input?.action === 'press' && !input.targetId && typeof contents.sendInputEvent === 'function') {
          contents.focus?.();
          contents.sendInputEvent({ type: 'keyDown', keyCode: input.key });
          contents.sendInputEvent({ type: 'keyUp', keyCode: input.key });
          return;
        }
        await contents.executeJavaScript(interactionScript(input), true);
      });
      return captureSurface(contents);
    },
    async wait(id, ms) {
      if (!Number.isInteger(ms) || ms < 1 || ms > 10_000) throw new Error('desktop browser wait accepts 1-10000 milliseconds');
      await new Promise(resolve => setTimeout(resolve, ms));
      return captureSurface(requireSurface(surfaces, id).view.webContents);
    },
    async drainEvents(id) {
      const surface = requireSurface(surfaces, id);
      const pageEvents = await readPageEvents(surface.view.webContents);
      const events = [...surface.events, ...pageEvents];
      surface.events.length = 0;
      return events;
    },
    hide(id, leaseId) {
      const surface = surfaces.get(id);
      if (!surface) return;
      if (leaseId && surface.leaseId && surface.leaseId !== leaseId) return;
      if (!surface.attached) return;
      const window = getWindow();
      if (window) window.contentView.removeChildView(surface.view);
      surface.attached = false;
      surface.leaseId = undefined;
    },
    close(id) {
      const surface = surfaces.get(id);
      if (!surface) return;
      this.hide(id);
      surfaces.delete(id);
      surface.view.webContents.close();
    },
    dispose() {
      for (const id of [...surfaces.keys()]) this.close(id);
    },
  };
}

function configureRemoteContent(contents, surface) {
  contents.setWindowOpenHandler(({ url }) => {
    const source = surface.agentAction ? 'agent' : 'human';
    if (!isAllowedUrl(url)) {
      surface.events.push({ source, type: 'navigation', detail: `popup_blocked:${url}` });
      return { action: 'deny' };
    }
    surface.events.push({ source, type: 'navigation', detail: url });
    surface.pendingNavigationUrl = url;
    surface.pendingNavigation = contents.loadURL(url).then(() => installEventMonitor(contents));
    surface.pendingNavigation.catch(() => undefined);
    if (source === 'human') {
      surface.pendingNavigation.then(
        () => clearPendingNavigation(surface),
        () => clearPendingNavigation(surface),
      );
    }
    return { action: 'deny' };
  });
  contents.session?.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  contents.on?.('before-input-event', (event) => {
    if (!surface.inputEnabled && !surface.agentAction) event.preventDefault();
  });
  contents.on?.('will-navigate', (event, url) => {
    if (!isAllowedUrl(url)) { event.preventDefault(); return; }
    if (surface.pendingNavigationUrl === url) return;
    surface.events.push({ source: surface.agentAction ? 'agent' : 'human', type: 'navigation', detail: url });
  });
}

function clearPendingNavigation(surface) {
  surface.pendingNavigation = undefined;
  surface.pendingNavigationUrl = undefined;
}

async function withAgentAction(contents, surface, action) {
  await markAgentAction(contents, surface);
  try {
    await action();
    await new Promise(resolve => setImmediate(resolve));
    const navigation = surface.pendingNavigation;
    if (navigation) await navigation;
  } finally {
    clearPendingNavigation(surface);
    await clearAgentAction(contents, surface);
  }
}

function markAgentAction(contents, surface) {
  surface.agentAction = true;
  return contents.executeJavaScript("window.__4tormActionSource = 'agent'", true);
}

function clearAgentAction(contents, surface) {
  surface.agentAction = false;
  return contents.executeJavaScript('window.__4tormActionSource = undefined', true);
}

function requireSurface(surfaces, id) {
  const surface = surfaces.get(id);
  if (!surface) throw new Error('surface not found');
  return surface;
}

function assertUrl(url) {
  if (!isAllowedUrl(url)) throw new Error('surface URL is not allowed');
}

function isAllowedUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function normalizeBounds(value) {
  const { x, y, width, height } = value || {};
  if (![x, y, width, height].every(Number.isFinite) || width < 1 || height < 1) throw new Error('surface bounds are invalid');
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}

async function captureSurface(contents) {
  const [image, snapshot] = await Promise.all([
    contents.capturePage(),
    contents.executeJavaScript(SNAPSHOT_SCRIPT, true),
  ]);
  return {
    frame: image.toPNG(),
    title: contents.getTitle(),
    url: contents.getURL(),
    text: snapshot.text,
    targets: snapshot.targets,
  };
}

const SNAPSHOT_SCRIPT = `(() => {
  const stableDigest = value => { let hash = 0; for (let index = 0; index < value.length; index++) hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0; return Math.abs(hash).toString(16).padStart(10, '0').slice(-10); };
  const targetIdFor = (index, element) => {
    const role = element.getAttribute('role') || element.tagName.toLowerCase();
    const name = (element.getAttribute('aria-label') || element.placeholder || element.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 120);
    const href = element instanceof HTMLAnchorElement ? element.href : '';
    return \`target-\${index}-\${stableDigest(role + '\\u0000' + name + '\\u0000' + href)}\`;
  };
  return {
    text: (document.body?.innerText ?? '').replace(/\\s+/g, ' ').trim().slice(0, 1600),
    targets: [...document.querySelectorAll('a,button,input,textarea,select,[role="button"],[contenteditable="true"]')]
      .filter(element => element.offsetParent !== null)
      .slice(0, 24)
      .map((element, index) => ({
        index,
        role: element.getAttribute('role') || element.tagName.toLowerCase(),
        name: (element.getAttribute('aria-label') || element.placeholder || element.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 120),
        href: element instanceof HTMLAnchorElement ? element.href : undefined,
        bounds: (() => { const rect = element.getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }; })(),
        visible: true,
        enabled: !element.disabled,
        id: targetIdFor(index, element),
      })),
  };
})()`;

function interactionScript(input) {
  const { action, targetId, x, y, text, key } = input || {};
  if (!['click', 'click_at', 'type', 'press'].includes(action)) throw new Error('desktop browser interaction is invalid');
  if (action === 'type' && typeof text !== 'string') throw new Error('desktop browser type requires text');
  if (action === 'press' && (typeof key !== 'string' || !key)) throw new Error('desktop browser press requires key');
  if (action === 'click_at' && (!Number.isFinite(x) || !Number.isFinite(y))) throw new Error('desktop browser click_at requires x and y');
  if (action !== 'press' && action !== 'click_at' && typeof targetId !== 'string') throw new Error('desktop browser action requires targetId');
  const payload = JSON.stringify({ action, targetId, x, y, text, key });
  return `(() => {
    const input = ${payload};
    window.__4tormActionSource = 'agent';
    const stableDigest = value => { let hash = 0; for (let index = 0; index < value.length; index++) hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0; return Math.abs(hash).toString(16).padStart(10, '0').slice(-10); };
    const targetIdFor = (index, element) => {
      const role = element.getAttribute('role') || element.tagName.toLowerCase();
      const name = (element.getAttribute('aria-label') || element.placeholder || element.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 120);
      const href = element instanceof HTMLAnchorElement ? element.href : '';
      return \`target-\${index}-\${stableDigest(role + '\\u0000' + name + '\\u0000' + href)}\`;
    };
    const resolveTarget = (elements, value) => {
      const match = /^target-(\\d+)-([a-f0-9]{10})$/.exec(value || '');
      if (!match) throw new Error('browser targetId is invalid');
      const index = Number(match[1]);
      const element = elements[index];
      if (!element || targetIdFor(index, element) !== value) throw new Error('browser targetId is stale');
      return element;
    };
    const elements = [...document.querySelectorAll('a,button,input,textarea,select,[role="button"],[contenteditable="true"]')]
      .filter(element => element.offsetParent !== null);
    const element = input.action === 'click_at' ? document.elementFromPoint(input.x, input.y) : input.action === 'press' && !input.targetId ? document.activeElement : resolveTarget(elements, input.targetId);
    if (!element) throw new Error('browser target is no longer available');
    element.focus?.();
    if (input.action === 'click' || input.action === 'click_at') { element.click(); queueMicrotask(() => { window.__4tormActionSource = undefined; }); return; }
    if (input.action === 'type') {
      if (!('value' in element)) throw new Error('browser target does not accept text');
      element.value = input.text;
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      queueMicrotask(() => { window.__4tormActionSource = undefined; }); return;
    }
    element.dispatchEvent(new KeyboardEvent('keydown', { key: input.key, bubbles: true }));
    element.dispatchEvent(new KeyboardEvent('keyup', { key: input.key, bubbles: true }));
    queueMicrotask(() => { window.__4tormActionSource = undefined; });
  })()`;
}

const EVENT_MONITOR_SCRIPT = `(() => {
  if (window.__4tormEventMonitor) return;
  window.__4tormEventMonitor = true;
  window.__4tormEvents = [];
  const push = (type, detail) => window.__4tormEvents.push({ source: window.__4tormActionSource === 'agent' ? 'agent' : 'human', type, detail });
  for (const type of ['click', 'input', 'change']) document.addEventListener(type, event => push(type, event.target?.tagName?.toLowerCase() || ''), true);
  document.addEventListener('focusin', event => push('focus', event.target?.tagName?.toLowerCase() || ''), true);
})()`;

async function installEventMonitor(contents) {
  await contents.executeJavaScript(EVENT_MONITOR_SCRIPT, true);
}

async function readPageEvents(contents) {
  return contents.executeJavaScript(`(() => { const events = window.__4tormEvents || []; window.__4tormEvents = []; return events; })()`, true)
    .then(events => Array.isArray(events) ? events.filter(isBrowserEvent) : [])
    .catch(() => []);
}

function isBrowserEvent(value) {
  return value && typeof value === 'object'
    && ['agent', 'human', 'page'].includes(value.source)
    && ['navigation', 'click', 'input', 'change', 'focus', 'mutation'].includes(value.type);
}

module.exports = { createSurfaceRegistry };
