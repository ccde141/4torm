import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const servicesDir = path.dirname(fileURLToPath(import.meta.url));
const read = (file: string) => fs.readFileSync(path.join(servicesDir, file), 'utf8');

test('execution observation contracts stay independent from browser implementations', () => {
  const observer = read('execution-observer.ts');
  const contract = read('execution-observation-contract.ts');
  const browserProtocol = read('browser-protocol.ts');

  assert.doesNotMatch(observer, /browser-protocol/);
  assert.match(contract, /export type ObservationPresentation/);
  assert.match(browserProtocol, /execution-observation-contract/);
});

test('browser execution producer names the capability rather than one driver', () => {
  const producer = read('browser-execution-producer.ts');
  const routes = read('../routes/tools.ts');

  assert.match(producer, /class BrowserExecutionProducer/);
  assert.doesNotMatch(producer, /PlaywrightBrowserProducer|playwrightBrowserProducer/);
  assert.match(routes, /browserExecutionProducer/);
  assert.doesNotMatch(routes, /playwrightBrowserProducer/);
});

test('tool and surface routes depend on the capability registry instead of browser branches', () => {
  const routes = read('../routes/tools.ts');
  const builtins = read('builtin-execution-capabilities.ts');

  assert.match(routes, /executionCapabilities\.findTool/);
  assert.match(routes, /executionCapabilities\.requireSurface/);
  assert.doesNotMatch(routes, /if \(tool === 'browser'\)/);
  assert.match(builtins, /register\(browserExecutionCapability\)/);
});
