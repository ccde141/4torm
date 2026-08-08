import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const sharedDir = fileURLToPath(new URL('.', import.meta.url));
const engineDir = path.dirname(sharedDir);
const featureImport = /(?:from\s+|import\s*\()\s*['"][^'"]*(?:engine\/)?(?:conversation|convection|cyclone|tradewind|tide)(?:\/|['"])/g;
const featureServiceImport = /(?:from\s+|import\s*\()\s*['"][^'"]*services\/(?:tide|tradewind(?:-execution|-tools)?)(?:\/|\.js|['"])/g;

function productionFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) return productionFiles(target);
    if (!entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) return [];
    return [target];
  });
}

test('shared kernel never imports feature-owned implementation', () => {
  const violations = productionFiles(sharedDir).flatMap((file) => {
    const source = fs.readFileSync(file, 'utf8');
    const matches = [...source.matchAll(featureImport), ...source.matchAll(featureServiceImport)];
    return matches.map((match) => `${path.relative(sharedDir, file)}: ${match[0]}`);
  });

  assert.deepEqual(violations, [], `shared -> feature reverse dependencies:\n${violations.join('\n')}`);
});

test('ReAct algorithms have one visible home without feature compatibility shells', () => {
  const removedShells = [
    'conversation/react-loop.ts',
    'conversation/react-loop-text.ts',
    'cyclone/react-loop.ts',
    'cyclone/react-loop-text.ts',
    'convection/react-loop.ts',
    'tradewind/execution/react-loop.ts',
  ];
  assert.deepEqual(
    removedShells.filter(relative => fs.existsSync(path.join(engineDir, relative))),
    [],
  );

  const nativeSource = fs.readFileSync(path.join(sharedDir, 'react/native-loop.ts'), 'utf8');
  assert.doesNotMatch(nativeSource, /export\s*\{\s*runReActLoop\s*\}\s*from\s*['\"]\.\/text-loop/);
  assert.equal(fs.existsSync(path.join(sharedDir, 'react/text-loop.ts')), true);
  assert.equal(fs.existsSync(path.join(engineDir, 'convection/convection-react-adapter.ts')), true);
  assert.equal(fs.existsSync(path.join(engineDir, 'tradewind/execution/tradewind-react-adapter.ts')), true);
});

test('framework tool definitions have one server-owned read-only home', () => {
  const projectRoot = path.resolve(sharedDir, '../../../..');
  const frontendStore = fs.readFileSync(path.join(projectRoot, 'src/store/tools.ts'), 'utf8');
  const registryTemplate = JSON.parse(fs.readFileSync(path.join(projectRoot, 'data/tools/registry.template.json'), 'utf8')) as unknown[];
  const gitignore = fs.readFileSync(path.join(projectRoot, '.gitignore'), 'utf8');

  assert.equal(fs.existsSync(path.join(projectRoot, 'server/src/tools/framework/catalog.json')), true);
  assert.doesNotMatch(frontendStore, /BUILTIN_TOOLS|seedTools|mergeBuiltinToolDefaults/);
  assert.deepEqual(registryTemplate, []);
  assert.match(gitignore, /^data\/tools\/registry\.json$/m);
});
