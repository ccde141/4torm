import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const files = [
  path.join(here, 'conversation-history.ts'),
  path.join(here, 'streamLoop.ts'),
  path.join(here, '../../components/chat/MessageItem.tsx'),
  path.join(here, '../../components/chat/ChatPage.tsx'),
];

for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  assert.doesNotMatch(source, /<(?:action|answer|think|result)\b/i);
}

console.log('chat text protocol UI ok');
