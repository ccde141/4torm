import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

// Run against the Vite development server; all API reads are isolated fixtures.
const base = process.env.TEAM_UI_URL || 'http://localhost:5173';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', error => errors.push(String(error)));
let state = { revision: 0, members: [], reports: [] };
let mutations = 0;
await page.route('**/api/**', async route => {
  if (route.request().method() !== 'GET') mutations++;
  const url = new URL(route.request().url());
  if (url.pathname.endsWith('/team/context')) return route.fulfill({ json: { messages: [
    { role: 'user', content: `背景 ${url.searchParams.get('memberId')}` },
    { role: 'assistant', content: '读取文件', toolCalls: [{ id: 'c', name: 'read_file', arguments: '{"path":"example.ts"}' }] },
    { role: 'tool', content: '文件内容', toolCallId: 'c' },
  ] } });
  return route.fulfill({ json: state });
});
await page.route('**/__team-check', route => route.fulfill({ contentType: 'text/html', body: `
<html><head><meta charset="utf-8"><style>
:root { --color-bg-secondary:#18191c; --color-bg-tertiary:#25262b; --color-text-primary:#eceef2; --color-text-secondary:#a4a9b3; --color-border:#34373e; }
body { margin:0; background:#111216; color:#eceef2; font-family:system-ui; } * { box-sizing:border-box; }
</style></head><body><div id="root"></div><script type="module">
import RefreshRuntime from '/@react-refresh';
RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$=()=>{}; window.$RefreshSig$=()=>type=>type;
window.__vite_plugin_react_preamble_installed__=true;
const ReactModule = await import('/node_modules/.vite/deps/react.js');
const React = ReactModule.default || ReactModule;
const Client = await import('/node_modules/.vite/deps/react-dom_client.js');
const { createRoot } = Client.default || Client;
const { LocaleProvider } = await import('/src/i18n/LocaleContext.tsx');
const { default: TeamView } = await import('/src/components/chat/team/TeamView.tsx');
const { TeamToolMessage } = await import('/src/components/chat/team/TeamToolMessage.tsx');
createRoot(document.getElementById('root')).render(React.createElement(LocaleProvider, null,
  React.createElement(React.Fragment, null,
    React.createElement('div', {style:{display:'flex',justifyContent:'flex-end',gap:8,padding:20}},
      React.createElement(TeamView, {agentId:'a',sessionId:'s',mainName:'主 Agent',mainBusy:false}),
      React.createElement('button',null,'工作区')),
    React.createElement(TeamToolMessage, {toolCall:{toolName:'team_dispatch',status:'success',params:{task:'核查停止与回报同时发生时的处理，补充触发条件与证据。'},result:'{"id":"run-one"}'}}))));
</script></body></html>` }));
try {
  await page.goto(`${base}/__team-check`);
  await page.waitForLoadState('networkidle');
  assert.deepEqual(errors, [], 'fixture must load without module errors');
  assert.equal(await page.locator('.team-tool-card details').getAttribute('open'), null);
  await page.locator('.team-tool-card strong').filter({ hasText: '向成员分配工作' }).waitFor();
  await page.locator('.session-team-entry').click();
  await page.locator('.session-team-empty').waitFor();
  const dialog = await page.locator('dialog').boundingBox();
  assert.ok(Math.abs(dialog.x + dialog.width / 2 - 720) < 2, 'dialog must be centered');
  const map = await page.locator('.session-team-map').boundingBox();
  const main = await page.locator('.session-team-main').boundingBox();
  assert.ok(Math.abs(main.x + main.width / 2 - map.x - map.width / 2) < 2, 'empty main node centered');
  const member = (id, status) => ({ id, name: `成员 ${id}`, mission: '调查与验证', rolePrompt: '专业角色', taskContext: '初始背景', constraints: '仅修改约定范围', lifecycle: 'active', run: { id: `run-${id}`, task: `任务 ${id}`, status } });
  state = { revision: 1, members: [member('one', 'completed'), member('two', 'failed')], reports: [
    { id: 'r1', memberId: 'one', runId: 'run-one', task: '任务 one', content: '部分结果，需要验证', outcome: 'completed', acknowledged: true },
    { id: 'r2', memberId: 'two', runId: 'run-two', task: '任务 two', content: '服务失败', outcome: 'failed', acknowledged: true, review: { decision: 'blocked', reason: '等待服务恢复' } },
  ] };
  await page.locator('header button').first().click();
  await page.locator('.session-team-branch').first().waitFor();
  assert.equal(await page.locator('.session-team-branch').count(), 2);
  await page.waitForFunction(() => document.querySelectorAll('.session-team-connections g').length === 2);
  assert.equal(await page.locator('.session-team-branch .session-team-node').first().getByText('待命', { exact: false }).count(), 1);
  await page.locator('.session-team-branch .session-team-node').first().click();
  assert.ok((await page.locator('.session-team-inspector').innerText()).includes('未判定完成'));
  await page.locator('.session-team-tabs button').nth(1).click();
  assert.equal(await page.locator('.session-team-tab-content').evaluate(element => getComputedStyle(element).animationTimingFunction), 'cubic-bezier(0.22, 1, 0.36, 1)');
  assert.equal(await page.locator('.session-team-selection-content').count(), 1);
  await page.locator('.session-team-transcript input').fill('背景 one');
  await page.locator('.session-team-message p').filter({ hasText: '背景 one' }).waitFor();
  await page.locator('.session-team-transcript input').fill('');
  await page.getByText('read_file', { exact: true }).click();
  await page.getByText('{"path":"example.ts"}', { exact: true }).waitFor();
  assert.equal(await page.locator('textarea').count(), 0);
  const screenshot = path.join(os.tmpdir(), '4torm-team-review.png');
  await page.screenshot({ path: screenshot, fullPage: true });
  await page.locator('.session-team-branch .session-team-node').nth(1).click();
  await page.locator('.session-team-tabs button').nth(1).click();
  await page.locator('.session-team-transcript input').fill('背景 two');
  await page.locator('.session-team-message p').filter({ hasText: '背景 two' }).waitFor();
  assert.equal(await page.getByText('背景 one', { exact: true }).count(), 0);
  state = { ...state, revision: 2, members: [member('one', 'running'), member('two', 'failed')] };
  await page.locator('header button').first().click();
  await page.locator('.session-team-connections .is-flowing').waitFor({ state: 'attached' });
  assert.equal(await page.locator('.session-team-connections .is-flowing').count(), 1);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await page.locator('.session-team-tab-content').evaluate(element => getComputedStyle(element).animationName), 'none');
  assert.equal(await page.locator('.session-team-selection-content').evaluate(element => getComputedStyle(element).animationName), 'none');
  assert.equal(await page.locator('.is-flowing .session-team-flow').evaluate(element => getComputedStyle(element).animationName), 'none');
  await page.setViewportSize({ width: 600, height: 800 });
  assert.ok(await page.locator('dialog').evaluate(element => element.scrollWidth <= element.clientWidth));
  await page.locator('dialog header button').last().click();
  await page.setViewportSize({ width: 1100, height: 650 });
  await page.locator('.team-collaboration-trigger').hover();
  await page.locator('.team-summary-popover').waitFor();
  assert.ok((await page.locator('.team-summary-popover').boundingBox()).width >= 500);
  await page.locator('.team-preview-root').waitFor();
  assert.equal(await page.locator('.team-preview-branch').count(), 2);
  assert.equal(await page.locator('dialog').count(), 0, 'hover must not open full panel');
  assert.equal(await page.locator('.team-summary-member').count(), 2);
  await page.screenshot({ path: path.join(os.tmpdir(), '4torm-team-summary.png'), fullPage: true });
  await page.keyboard.press('Escape');
  await page.locator('.team-summary-popover').waitFor({ state: 'detached' });
  await page.locator('.team-collaboration-trigger').blur();
  await page.locator('.team-collaboration-trigger').focus();
  await page.locator('.team-summary-popover').waitFor();
  await page.locator('.team-summary-member').nth(1).click();
  await page.locator('.session-team-inspector h3').filter({ hasText: '成员 two' }).waitFor();
  state = { ...state, revision: 3, members: ['one','two','three','four','five','six'].map(id => member(id, 'completed')) };
  await page.locator('dialog header button').first().click();
  await page.waitForFunction(() => document.querySelectorAll('.session-team-branch').length === 6);
  await page.locator('dialog header button').last().click();
  await page.setViewportSize({ width: 390, height: 640 });
  await page.locator('.team-collaboration-trigger').hover();
  await page.locator('.team-summary-popover').waitFor();
  assert.equal(await page.locator('.team-preview-branch').count(), 6);
  const previewBox = await page.locator('.team-summary-popover').boundingBox();
  assert.ok(previewBox.x >= 0 && previewBox.x + previewBox.width <= 390 && previewBox.y + previewBox.height <= 640);
  assert.ok(await page.locator('.team-summary-content').evaluate(el => el.scrollHeight > el.clientHeight && el.scrollWidth <= el.clientWidth));
  assert.equal(mutations, 0);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, screenshot, checks: ['centered empty state', 'report is not completion', 'read-only transcript', 'member isolation', 'mobile layout', 'no mutations'] }));
} finally { await browser.close(); }
