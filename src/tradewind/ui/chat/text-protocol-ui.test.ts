import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const files = [
  path.join(here, 'parser.ts'),
  path.join(here, 'AgentChatWindow.tsx'),
  path.join(here, '../meeting/MeetingMessageItem.tsx'),
];

for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  assert.doesNotMatch(source, /<(?:action|answer|think|result)\b/i);
}

console.log('tradewind agent chat text protocol UI ok');
