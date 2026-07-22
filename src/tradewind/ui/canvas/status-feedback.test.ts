import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

test('completed node feedback remains visible for fifteen seconds', async () => {
  const css = await fs.readFile(
    path.resolve(process.cwd(), 'src/styles/components/tradewind.css'),
    'utf8',
  );
  assert.match(
    css,
    /\.tw-node--just-done\s*\{\s*animation:\s*tw-node-done-pop\s+15s\b/,
    '完成反馈必须使用 15 秒动画，且不改变其他运行态动画',
  );
});

test('stopped and failed feedback is not hidden by the busy pulse', async () => {
  const css = await fs.readFile(
    path.resolve(process.cwd(), 'src/styles/components/tradewind.css'),
    'utf8',
  );
  assert.match(css, /\.tw-node--stopped\.tw-node--busy,\s*\.tw-node--failed\.tw-node--busy\s*\{\s*animation:\s*none\s*!important;/);
});
