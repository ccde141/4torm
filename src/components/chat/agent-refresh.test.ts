import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('季风激活时立即刷新 Agent，并监听创建与配置变更', () => {
  const source = fs.readFileSync('src/components/chat/ChatPage.tsx', 'utf8');

  assert.match(source, /import \{ AGENTS_CHANGED_EVENT \} from '\.\.\/\.\.\/store\/agent-events'/);
  assert.match(source, /if \(!active\) return;[\s\S]*?refreshAgents\(\);[\s\S]*?addEventListener\(AGENTS_CHANGED_EVENT/);
  assert.match(source, /removeEventListener\(AGENTS_CHANGED_EVENT/);
});
