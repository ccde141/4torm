import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('工具集合使用共享的轻量毛玻璃外观', () => {
  const css = fs.readFileSync('src/styles/components/chat.css', 'utf8');
  const component = fs.readFileSync('src/components/chat/ToolActivityGroup.tsx', 'utf8');
  const group = css.match(/\.tool-activity-group\s*\{([\s\S]*?)\}/)?.[1] ?? '';

  assert.match(group, /background:\s*var\(--glass-bg-soft\)/);
  assert.match(group, /border:\s*1px solid var\(--glass-border\)/);
  assert.match(group, /backdrop-filter:\s*blur\(/);
  assert.doesNotMatch(group, /background:\s*var\(--color-surface\)/);
  assert.doesNotMatch(css, /\.tool-activity-group--error/);
  assert.doesNotMatch(component, /tool-activity-group--error/);
});
