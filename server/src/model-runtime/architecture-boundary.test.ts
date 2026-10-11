import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const runtimeDir = fileURLToPath(new URL('.', import.meta.url));
const serverSrc = path.dirname(runtimeDir);
const contractsDir = path.join(runtimeDir, 'contracts');

function productionFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) return productionFiles(target);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [target] : [];
  });
}

test('model runtime starts from explicit provider and transport contracts', () => {
  for (const relative of [
    'contracts/provider-config.ts',
    'contracts/capabilities.ts',
    'contracts/verification.ts',
    'contracts/provider-configuration.ts',
    'config/provider-policy.ts',
    'config/llama-cpp-config.ts',
    'config/llama-cpp-schema.ts',
    'config/provider-selection-log.ts',
    'providers/provider-catalog.ts',
  ]) {
    assert.equal(fs.existsSync(path.join(runtimeDir, relative)), true, relative);
  }
});

test('model runtime contracts never depend on feature or runtime implementations', () => {
  const forbidden = /(?:from\s+|import\s*\()['"][^'"]*(?:engine\/(?:conversation|convection|cyclone|tradewind)|routes|services|providers|transports|runtime)(?:\/|['"])/g;
  const violations = productionFiles(contractsDir).flatMap(file => {
    const source = fs.readFileSync(file, 'utf8');
    return [...source.matchAll(forbidden)].map(match => `${path.relative(runtimeDir, file)}: ${match[0]}`);
  });
  assert.deepEqual(violations, []);
});

test('model runtime route delegates provider persistence and transport identity', () => {
  const route = fs.readFileSync(path.join(serverSrc, 'routes/model-runtime.ts'), 'utf8');
  assert.doesNotMatch(route, /node:fs|services\/data-paths|engine\/shared/);
});

test('feature islands do not bypass the model runtime through provider internals', () => {
  const featureDirs = ['conversation', 'convection', 'cyclone', 'tradewind']
    .map(name => path.join(serverSrc, 'engine', name));
  const forbidden = /engine\/shared\/(?:provider-adapters|provider-transports|provider-normalization)|model-runtime\/(?:providers|transports|capabilities|context)/;
  const violations = featureDirs.flatMap(productionFiles).flatMap(file => {
    const source = fs.readFileSync(file, 'utf8').replaceAll('\\', '/');
    return forbidden.test(source) ? [path.relative(serverSrc, file)] : [];
  });
  assert.deepEqual(violations, []);
});

test('provider implementations have one home while legacy paths are compatibility shells', () => {
  for (const relative of [
    'contracts/provider-adapter.ts',
    'providers/registry.ts',
    'providers/openai-compatible.ts',
    'providers/llama-cpp.ts',
    'providers/request-normalization.ts',
    'providers/message-normalization.ts',
  ]) {
    assert.equal(fs.existsSync(path.join(runtimeDir, relative)), true, relative);
  }
  const legacyDir = path.join(serverSrc, 'engine/shared/provider-adapters');
  const legacyFiles = productionFiles(legacyDir).map(file => path.basename(file)).sort();
  assert.deepEqual(legacyFiles, ['registry.ts', 'types.ts']);
  for (const file of productionFiles(legacyDir)) {
    assert.match(fs.readFileSync(file, 'utf8'), /^export\s+(?:type\s+)?\{/);
  }
});
