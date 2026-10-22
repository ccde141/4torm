import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const SRC = path.resolve('src');
const TIDE_ROOT = path.join(SRC, 'modules', 'tide');
const MONSOON_ROOT = path.join(SRC, 'modules', 'monsoon');
const TRADEWIND_ROOT = path.join(SRC, 'modules', 'tradewind');
const CONVECTION_ROOT = path.join(SRC, 'modules', 'convection');
const CYCLONE_ROOT = path.join(SRC, 'modules', 'cyclone');
const AGENTS_ROOT = path.join(SRC, 'modules', 'agents');

test('code outside Agents can import only its public module entry', async () => {
  const files = await typeScriptFiles(SRC);
  const violations: string[] = [];
  for (const file of files.filter(candidate => !candidate.startsWith(AGENTS_ROOT))) {
    const source = await fs.readFile(file, 'utf8');
    for (const specifier of importsOf(source)) {
      if (!specifier.includes('modules/agents/')) continue;
      if (specifier.endsWith('modules/agents/public.js')) continue;
      violations.push(`${path.relative(SRC, file)} -> ${specifier}`);
    }
  }
  assert.deepEqual(violations, []);
});

test('code outside Tide can import only its public module entry', async () => {
  const files = await typeScriptFiles(SRC);
  const violations: string[] = [];
  for (const file of files.filter(candidate => !candidate.startsWith(TIDE_ROOT))) {
    const source = await fs.readFile(file, 'utf8');
    for (const specifier of importsOf(source)) {
      if (!specifier.includes('modules/tide/')) continue;
      if (specifier.endsWith('modules/tide/public.js')) continue;
      violations.push(`${path.relative(SRC, file)} -> ${specifier}`);
    }
  }
  assert.deepEqual(violations, []);
});

test('Tide public entry exposes construction without leaking repositories', async () => {
  const source = await fs.readFile(path.join(TIDE_ROOT, 'public.ts'), 'utf8');
  assert.match(source, /createTideFeatureModule/);
  assert.doesNotMatch(source, /FileTideTaskRepository|TideTaskRepository/);
});

test('Tide has one module implementation and no legacy service island', async () => {
  await assert.rejects(fs.access(path.join(SRC, 'services', 'tide')));
  const route = await fs.readFile(path.join(SRC, 'routes', 'tide.ts'), 'utf8');
  assert.match(route, /modules\/tide\/public\.js/);
  assert.doesNotMatch(route, /services\/tide/);
  const entry = await fs.readFile(path.join(SRC, 'index.ts'), 'utf8');
  assert.doesNotMatch(entry, /services\/tide/);
});

test('code outside Monsoon can import only its public module entry', async () => {
  const files = await typeScriptFiles(SRC);
  const violations: string[] = [];
  for (const file of files.filter(candidate => !candidate.startsWith(MONSOON_ROOT))) {
    const source = await fs.readFile(file, 'utf8');
    for (const specifier of importsOf(source)) {
      if (!specifier.includes('modules/monsoon/')) continue;
      if (specifier.endsWith('modules/monsoon/public.js')) continue;
      violations.push(`${path.relative(SRC, file)} -> ${specifier}`);
    }
  }
  assert.deepEqual(violations, []);
});

test('Monsoon owns its HTTP entry behind the public module facade', async () => {
  await assert.rejects(fs.access(path.join(SRC, 'routes', 'conversation.ts')));
  for (const legacy of ['conversation-title.ts', 'conversation-input.ts', 'conversation-team.ts',
    'conversation-attachments.ts']) {
    await assert.rejects(fs.access(path.join(SRC, 'routes', legacy)));
  }
  await assert.rejects(fs.access(path.join(SRC, 'services', 'conversation-attachments.ts')));
  const route = await fs.readFile(path.join(MONSOON_ROOT, 'api', 'routes.ts'), 'utf8');
  assert.match(route, /\.\/attachments\.js/);
  assert.doesNotMatch(route, /activeRunners|activeRunnerLeases|new Map<string, SessionRunner>/);
  const publicEntry = await fs.readFile(path.join(MONSOON_ROOT, 'public.ts'), 'utf8');
  assert.match(publicEntry, /createMonsoonFeature/);
  assert.match(publicEntry, /monsoonRoutes/);
  assert.doesNotMatch(publicEntry, /MonsoonSessionRegistry|SessionTeams/);
  const index = await fs.readFile(path.join(SRC, 'index.ts'), 'utf8');
  assert.doesNotMatch(index, /routes\/conversation(?:\.js)?['"]/);
  assert.match(index, /modules\/monsoon\/public\.js/);
});

test('Monsoon application and API depend on its turn contract, not the legacy runner', async () => {
  const allowed = path.join(MONSOON_ROOT, 'runtime', 'runner-adapter.ts');
  for (const file of (await typeScriptFiles(MONSOON_ROOT)).filter(file =>
    !file.endsWith('.test.ts') && file !== allowed)) {
    const source = await fs.readFile(file, 'utf8');
    assert.ok(!importsOf(source).some(specifier => specifier.includes('/session-runner')),
      path.relative(SRC, file));
  }
});

test('Monsoon application layer does not import the legacy conversation feature', async () => {
  const root = path.join(MONSOON_ROOT, 'application');
  for (const file of (await typeScriptFiles(root)).filter(file => !file.endsWith('.test.ts'))) {
    const source = await fs.readFile(file, 'utf8');
    assert.ok(!importsOf(source).some(specifier => specifier.includes('/engine/conversation/')),
      path.relative(SRC, file));
  }
});

test('Monsoon HTTP adapters do not inspect session storage paths directly', async () => {
  const root = path.join(MONSOON_ROOT, 'api');
  for (const file of (await typeScriptFiles(root)).filter(file => !file.endsWith('.test.ts'))) {
    const source = await fs.readFile(file, 'utf8');
    const imports = importsOf(source);
    assert.ok(!imports.includes('node:fs') && !imports.includes('node:fs/promises'),
      path.relative(SRC, file));
    assert.ok(!imports.some(specifier => specifier.includes('/services/data-paths')),
      path.relative(SRC, file));
  }
});

test('Monsoon HTTP adapters depend on module ports instead of legacy conversation services', async () => {
  const root = path.join(MONSOON_ROOT, 'api');
  for (const file of (await typeScriptFiles(root)).filter(file => !file.endsWith('.test.ts'))) {
    const source = await fs.readFile(file, 'utf8');
    assert.ok(!importsOf(source).some(specifier => specifier.includes('/engine/conversation/')),
      path.relative(SRC, file));
  }
});

test('code outside Tradewind can import only its public module entry', async () => {
  const files = await typeScriptFiles(SRC);
  const violations: string[] = [];
  for (const file of files.filter(candidate => !candidate.startsWith(TRADEWIND_ROOT))) {
    const source = await fs.readFile(file, 'utf8');
    for (const specifier of importsOf(source)) {
      if (!specifier.includes('modules/tradewind/')) continue;
      if (specifier.endsWith('modules/tradewind/public.js')) continue;
      violations.push(`${path.relative(SRC, file)} -> ${specifier}`);
    }
  }
  assert.deepEqual(violations, []);
});

test('Tradewind public entry exposes its feature without leaking the legacy orchestrator', async () => {
  const source = await fs.readFile(path.join(TRADEWIND_ROOT, 'public.ts'), 'utf8');
  assert.match(source, /createTradewindFeature/);
  assert.doesNotMatch(source, /Orchestrator|activeNodeRunners|activeHumanGates/);
});

test('code outside Convection can import only its public module entry', async () => {
  const files = await typeScriptFiles(SRC);
  const violations: string[] = [];
  for (const file of files.filter(candidate => !candidate.startsWith(CONVECTION_ROOT))) {
    const source = await fs.readFile(file, 'utf8');
    for (const specifier of importsOf(source)) {
      if (!specifier.includes('modules/convection/')) continue;
      if (specifier.endsWith('modules/convection/public.js')) continue;
      violations.push(`${path.relative(SRC, file)} -> ${specifier}`);
    }
  }
  assert.deepEqual(violations, []);
});

test('Convection public entry exposes construction without leaking session storage', async () => {
  const source = await fs.readFile(path.join(CONVECTION_ROOT, 'public.ts'), 'utf8');
  assert.match(source, /createConvectionFeature/);
  assert.doesNotMatch(source, /listSessions|getActiveConvectionRound/);
});

test('code outside Cyclone can import only its public module entry', async () => {
  const files = await typeScriptFiles(SRC);
  const violations: string[] = [];
  for (const file of files.filter(candidate => !candidate.startsWith(CYCLONE_ROOT))) {
    const source = await fs.readFile(file, 'utf8');
    for (const specifier of importsOf(source)) {
      if (!specifier.includes('modules/cyclone/')) continue;
      if (specifier.endsWith('modules/cyclone/public.js')) continue;
      violations.push(`${path.relative(SRC, file)} -> ${specifier}`);
    }
  }
  assert.deepEqual(violations, []);
});

test('Cyclone public entry exposes construction without leaking dispatch storage', async () => {
  const source = await fs.readFile(path.join(CYCLONE_ROOT, 'public.ts'), 'utf8');
  assert.match(source, /createCycloneFeature/);
  assert.doesNotMatch(source, /listWorkshopDispatches|listWorkshops/);
});

async function typeScriptFiles(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async entry => {
    const target = path.join(root, entry.name);
    return entry.isDirectory() ? typeScriptFiles(target) : target.endsWith('.ts') ? [target] : [];
  }));
  return nested.flat();
}

test('shared probe protocol has no feature, transport, filesystem or model dependencies', async () => {
  const root = path.join(SRC, 'shared', 'probes');
  for (const file of (await typeScriptFiles(root)).filter(file => !file.endsWith('.test.ts'))) {
    const source = await fs.readFile(file, 'utf8');
    for (const specifier of importsOf(source)) {
      assert.ok(specifier.startsWith('./'), `${path.relative(SRC, file)} -> ${specifier}`);
    }
  }
});

function importsOf(source: string): string[] {
  const imports: string[] = [];
  const pattern = /(?:from\s+|import\s*\()(['"])([^'"]+)\1/g;
  for (const match of source.matchAll(pattern)) imports.push(match[2]!);
  return imports;
}

test('relative imports cannot bypass feature public entries', async () => {
  const roots = [TIDE_ROOT, MONSOON_ROOT, TRADEWIND_ROOT, CONVECTION_ROOT, CYCLONE_ROOT, AGENTS_ROOT];
  const violations: string[] = [];
  for (const file of (await typeScriptFiles(SRC)).filter(file => !file.endsWith('.test.ts'))) {
    const source = await fs.readFile(file, 'utf8');
    for (const specifier of importsOf(source).filter(value => value.startsWith('.'))) {
      const target = path.resolve(path.dirname(file), specifier);
      for (const root of roots) {
        if (!target.startsWith(`${root}${path.sep}`) || file.startsWith(`${root}${path.sep}`)) continue;
        if (target !== path.join(root, 'public.js')) violations.push(`${path.relative(SRC, file)} -> ${specifier}`);
      }
    }
  }
  assert.deepEqual(violations, []);
});
