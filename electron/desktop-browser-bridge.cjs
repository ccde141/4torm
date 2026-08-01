'use strict';

const net = require('node:net');
const MAX_REQUEST_BYTES = 32 * 1024 * 1024;

function createDesktopBrowserBridge({ token, registry }) {
  return {
    async handle(input) {
      const id = typeof input?.id === 'string' ? input.id : null;
      try {
        if (!id) throw new Error('desktop browser request id is invalid');
        if (input.token !== token) throw new Error('desktop browser bridge is unauthorized');
        const result = await dispatch(registry, input.action, input.payload);
        return { id, ok: true, result: encodeResult(input.action, result) };
      } catch (error) {
        return { id, ok: false, error: error.message };
      }
    },
  };
}

async function dispatch(registry, action, payload) {
  const executionId = requireExecutionId(payload?.executionId);
  if (action === 'open') {
    await registry.create(executionId, requireUrl(payload?.url));
    return registry.inspect(executionId);
  }
  if (action === 'navigate') return registry.navigate(executionId, requireUrl(payload?.url));
  if (action === 'inspect') return registry.inspect(executionId);
  if (action === 'interact') return registry.interact(executionId, payload);
  if (action === 'wait') return registry.wait(executionId, payload?.ms);
  if (action === 'events') return registry.drainEvents(executionId);
  if (action === 'close') {
    registry.close(executionId);
    return undefined;
  }
  throw new Error('desktop browser action is unsupported');
}

function requireExecutionId(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9-]{1,128}$/.test(value)) throw new Error('desktop browser execution id is invalid');
  return value;
}

function requireUrl(value) {
  if (typeof value !== 'string') throw new Error('desktop browser URL is invalid');
  return value;
}

function encodeCapture(capture) {
  return { ...capture, frame: capture.frame.toString('base64') };
}

function encodeResult(action, result) {
  if (!result || action === 'events') return result;
  return encodeCapture(result);
}

function createDesktopBrowserBridgeServer({ bridge, endpoint }) {
  if (!bridge || typeof bridge.handle !== 'function') throw new Error('desktop browser bridge handler is invalid');
  if (typeof endpoint !== 'string' || !endpoint) throw new Error('desktop browser bridge endpoint is invalid');
  const server = net.createServer(socket => bindConnection(socket, bridge));

  return {
    listen: () => new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(endpoint, () => { server.off('error', reject); resolve(); });
    }),
    close: () => new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    }),
  };
}

function bindConnection(socket, bridge) {
  let pending = '';
  socket.setEncoding('utf8');
  socket.on('data', chunk => {
    pending += chunk;
    if (Buffer.byteLength(pending) > MAX_REQUEST_BYTES) {
      socket.end(JSON.stringify({ id: null, ok: false, error: 'desktop browser bridge request is too large' }) + '\n');
      return;
    }
    let newline;
    while ((newline = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, newline).trim();
      pending = pending.slice(newline + 1);
      if (line) void reply(socket, bridge, line);
    }
  });
}

async function reply(socket, bridge, line) {
  let input;
  try { input = JSON.parse(line); }
  catch { socket.write(JSON.stringify({ id: null, ok: false, error: 'desktop browser bridge request is invalid JSON' }) + '\n'); return; }
  const result = await bridge.handle(input);
  if (!socket.destroyed) socket.write(JSON.stringify(result) + '\n');
}

module.exports = { createDesktopBrowserBridge, createDesktopBrowserBridgeServer };
