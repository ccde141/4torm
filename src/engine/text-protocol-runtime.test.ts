import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function runtimeSources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return runtimeSources(file);
    if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) return [];
    return [file];
  });
}

test('runtime source contains no legacy XML tool protocol literals', () => {
  const files = [
    ...runtimeSources(path.join(projectDir, 'src')),
    ...runtimeSources(path.join(projectDir, 'server/src/engine')),
  ];
  const offenders = files.filter(file => /<(?:action|answer|think|result)\b/i.test(fs.readFileSync(file, 'utf8')));
  assert.deepEqual(offenders.map(file => path.relative(projectDir, file)), []);
});
