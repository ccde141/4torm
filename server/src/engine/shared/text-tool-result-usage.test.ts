import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const files = [
  path.join(here, '../conversation/session-runner.ts'),
  path.join(here, '../cyclone/seat-runner.ts'),
  path.join(here, '../cyclone/seat-tool-registration.ts'),
  path.join(here, 'tool-registration-response.ts'),
];

for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  assert.doesNotMatch(source, /<result\s+tool=/);
}

console.log('text tool result usage ok');
