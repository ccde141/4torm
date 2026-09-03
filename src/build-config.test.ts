import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const chatStore = fs.readFileSync('src/store/chat.ts', 'utf8');
const viteConfig = fs.readFileSync('vite.config.ts', 'utf8');

test('session aggregation does not use an ineffective dynamic agent import', () => {
  assert.doesNotMatch(chatStore, /await import\('\.\/agent'\)/);
  assert.match(chatStore, /import \{ getAgents \} from '\.\/agent';/);
});

test('production build separates heavy stable libraries from application code', () => {
  assert.match(viteConfig, /rolldownOptions:/);
  assert.match(viteConfig, /codeSplitting:/);
  assert.match(viteConfig, /name: 'react-vendor'/);
  assert.match(viteConfig, /name: 'flow-vendor'/);
  assert.match(viteConfig, /name: 'content-vendor'/);
  assert.match(viteConfig, /name: 'conversation-feature'/);
  assert.match(viteConfig, /name: 'convection-feature'/);
  assert.match(viteConfig, /name: 'cyclone-feature'/);
  assert.match(viteConfig, /name: 'tradewind-feature'/);
  assert.match(viteConfig, /name: 'tide-feature'/);
});
