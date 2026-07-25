import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const engineDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('runtime no longer exposes legacy XML answer cleaners', () => {
  assert.equal(fs.existsSync(path.join(engineDir, 'shared/answer-extractor.ts')), false);

  for (const relativePath of [
    'conversation/react-loop.ts',
    'cyclone/react-loop.ts',
    'tradewind/execution/react-loop.ts',
  ]) {
    const source = fs.readFileSync(path.join(engineDir, relativePath), 'utf8');
    assert.doesNotMatch(source, /function stripInternalTags/);
  }
});
