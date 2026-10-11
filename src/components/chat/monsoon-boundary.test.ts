import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve('src/components/chat');
const expected = [
  'ChatPage.tsx', 'MonsoonSidebar.tsx', 'MonsoonConversation.tsx',
  'useMonsoonScroll.ts', 'useMonsoonTaskboard.ts', 'useMonsoonImages.ts',
  'useMonsoonCatalog.ts',
];

test('Monsoon page is composed from bounded feature modules', () => {
  for (const name of expected) {
    const file = path.join(root, name);
    assert.equal(fs.existsSync(file), true, `${name} is missing`);
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).length;
    assert.ok(lines <= 300, `${name} has ${lines} lines`);
  }
  const page = fs.readFileSync(path.join(root, 'ChatPage.tsx'), 'utf8');
  assert.match(page, /<MonsoonSidebar/);
  assert.match(page, /<MonsoonConversation/);
});
