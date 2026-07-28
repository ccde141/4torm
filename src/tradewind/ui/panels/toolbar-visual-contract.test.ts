import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const toolbar = fs.readFileSync('src/tradewind/ui/panels/Toolbar.tsx', 'utf8');
const styles = fs.readFileSync('src/styles/components/tradewind.css', 'utf8');

test('工作区入口采用季风式胶囊按钮与外跳反馈', () => {
  assert.match(toolbar, /className="tw-toolbar__workspace-btn"/);
  assert.match(toolbar, /tw-toolbar__workspace-btn-icon[^>]*>↗</);
  assert.match(styles, /\.tw-toolbar__workspace-btn\s*\{[^}]*border-radius:\s*var\(--border-radius-full\)/s);
  assert.match(styles, /\.tw-toolbar__workspace-btn:hover[^}]*translateY\(-1px\)/s);
  assert.match(styles, /\.tw-toolbar__workspace-btn:active[^}]*scale\(0\.97\)/s);
  assert.match(styles, /\.tw-toolbar__workspace-btn-icon[^}]*var\(--duration-fast\)[^}]*var\(--ease-out-back\)/s);
});
