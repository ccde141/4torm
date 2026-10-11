import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { createConvectionFeature } from '../../modules/convection/public.js';
import { createCycloneFeature } from '../../modules/cyclone/public.js';
import { createTideFeature } from '../../modules/tide/public.js';
import { createTradewindFeature } from '../../modules/tradewind/public.js';

test('前端中心调用的方法全部存在于对应功能岛运行时清单', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-frontend-contract-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const manifests = [
    createConvectionFeature({ dataDir }).module.manifest,
    createCycloneFeature({ dataDir }).module.manifest,
    createTideFeature({ dataDir }).module.manifest,
    createTradewindFeature({ dataDir }).module.manifest,
  ];
  const available = new Map(manifests.map(manifest => [
    manifest.id, new Set(manifest.methods.map(method => method.id)),
  ]));
  const calls = await frontendFeatureCalls(path.resolve('..', 'src'));

  assert.ok(calls.length >= 40, '未扫描到预期数量的前端中心调用');
  for (const call of calls) {
    assert.ok(available.get(call.feature)?.has(call.method),
      `${call.file}: ${call.feature}.${call.method} 不存在于后端运行时清单`);
  }
});

interface FrontendFeatureCall { feature: string; method: string; file: string }

async function frontendFeatureCalls(root: string): Promise<FrontendFeatureCall[]> {
  const entries = await fs.readdir(root, { recursive: true });
  const files = entries.filter(entry => /\.(ts|tsx)$/.test(entry) && !entry.endsWith('.test.ts'));
  const calls: FrontendFeatureCall[] = [];
  for (const file of files) {
    const absolute = path.join(root, file);
    const source = ts.createSourceFile(file, await fs.readFile(absolute, 'utf8'),
      ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    visit(source, file, calls);
  }
  return calls;
}

function visit(node: ts.Node, file: string, calls: FrontendFeatureCall[]): void {
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)
    && node.expression.text === 'invokeFeature') {
    const [feature, method] = node.arguments;
    if (feature && method && ts.isStringLiteral(feature) && ts.isStringLiteral(method)) {
      calls.push({ feature: feature.text, method: method.text, file });
    }
  }
  ts.forEachChild(node, child => visit(child, file, calls));
}
