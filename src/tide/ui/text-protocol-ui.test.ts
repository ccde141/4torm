import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('tide renders assistant content without a legacy protocol parser', () => {
  const source = fs.readFileSync(path.join(srcDir, 'tide/ui/TidePage.tsx'), 'utf8');
  assert.doesNotMatch(source, /parseStructuredOutput|parsed\.(?:think|actions|answer|note)/);
  assert.equal(fs.existsSync(path.join(srcDir, 'engine/parser.ts')), false);
});
