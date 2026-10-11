import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const serverRoot = path.resolve('src');
const moduleRoot = path.join(serverRoot, 'modules', 'convection');

test('对流会话持久化由功能模块拥有且旧引擎不再提供存储入口', () => {
  assert.equal(fs.existsSync(path.join(serverRoot, 'engine', 'convection', 'session.ts')), false);
  assert.equal(fs.existsSync(path.join(moduleRoot, 'infrastructure', 'session-store.ts')), true);
  for (const file of typescriptFiles(moduleRoot)) {
    const source = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /engine\/convection\/session/);
  }
});

function typescriptFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return typescriptFiles(target);
    return entry.isFile() && entry.name.endsWith('.ts') ? [target] : [];
  });
}
