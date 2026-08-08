import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const main = fs.readFileSync('electron/main.cjs', 'utf8');

test('Electron 启动服务不再通过 shell npx 创建难以回收的子进程树', () => {
  assert.equal(main.includes("spawn('npx'"), false);
  assert.equal(main.includes('shell: false'), true);
  assert.equal(main.includes('tsxCli'), true);
});
test('旧单实例被再次唤醒时先恢复后端再聚焦窗口', () => {
  const handler = main.slice(main.indexOf("app.on('second-instance'"), main.indexOf('app.whenReady()'));
  assert.equal(handler.includes('ensureServerReady()'), true);
  assert.equal(handler.includes('webContents.reload()'), true);
  assert.ok(handler.indexOf('ensureServerReady()') < handler.indexOf('focusMainWindow()'));
});
