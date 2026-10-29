import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

test('气旋默认主区使用关系图工作台且保留公告板', async () => {
  const source = await fs.readFile(new URL('../pages/CycloneWorkspacePane.tsx', import.meta.url), 'utf8');
  assert.match(source, /<OrganizationWorkspace/);
  assert.match(source, /bulletin=\{props\.bulletin\}/);
  assert.match(source, /runners=\{props\.seatRunners\}/);
  assert.match(source, /props\.tabs\.map\(tab =>/);
  assert.match(source, /display: managementView \? 'none' : 'flex'/);
  const primaryNavigation = source.indexOf('cyclone-org-workspace__tabs');
  const workspaceTabs = source.indexOf('<WorkshopTabs');
  const organization = source.indexOf('<OrganizationWorkspace');
  assert.ok(primaryNavigation >= 0 && primaryNavigation < workspaceTabs && workspaceTabs < organization);
});

test('关系图不提供建群捷径且群聊加号保留唯一创建入口', async () => {
  const canvas = await fs.readFile(new URL('./CycloneOrganizationCanvas.tsx', import.meta.url), 'utf8');
  const sidebar = await fs.readFile(new URL('../pages/CycloneSidebar.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(canvas, /onCreateRoom|selectedSeatIds|onSelectionChange/);
  assert.match(sidebar, /SectionHead[^>]*onAdd=\{props\.onCreateRoom\}/);
});

test('协作结构工具栏删除重复标题并按编辑、保存、状态的顺序显示', async () => {
  const canvas = await fs.readFile(new URL('./CycloneOrganizationCanvas.tsx', import.meta.url), 'utf8');
  const addGroup = canvas.indexOf("t('cyclone.org.addGroup')");
  const save = canvas.indexOf("t('cyclone.org.save')");
  const saveState = canvas.indexOf('cyclone-org__save-state');
  assert.ok(addGroup >= 0 && addGroup < save && save < saveState);
  assert.doesNotMatch(canvas, /<strong>\{t\('cyclone\.org\.title'\)\}<\/strong>/);
  assert.doesNotMatch(canvas, /onReload|cyclone\.org\.reload/);
});

test('关系图界面名称统一为协作结构', async () => {
  const messages = await fs.readFile(new URL('../../../i18n/cyclone-shell-messages.ts', import.meta.url), 'utf8');
  assert.match(messages, /'cyclone\.org\.graph': '协作结构'/);
  assert.match(messages, /'cyclone\.org\.save': '保存协作结构'/);
});

test('工位被删除后重新读取服务端组织版本并重基本地草稿', async () => {
  const workspace = await fs.readFile(new URL('./OrganizationWorkspace.tsx', import.meta.url), 'utf8');
  const reconciliation = await fs.readFile(new URL('./useOrganizationSeatReconciliation.ts', import.meta.url), 'utf8');
  assert.match(workspace, /useOrganizationSeatReconciliation/);
  assert.match(reconciliation, /removedSeatIds/);
  assert.match(reconciliation, /await loadOrganization\(options\.workshopId, controller\.signal\)/);
  assert.match(reconciliation, /rebaseEditableOrganization\(current, state, seats\)/);
  assert.match(reconciliation, /setReconciling\(true\)/);
  assert.match(workspace, /saving \|\| reconcilingSeats\.blocked/);
});

test('工位内容刷新不会取消同一集合正在进行的组织版本重基', async () => {
  const reconciliation = await fs.readFile(new URL('./useOrganizationSeatReconciliation.ts', import.meta.url), 'utf8');
  assert.match(reconciliation, /seatIdsKey/);
  assert.match(reconciliation, /pendingRebaseRef/);
  assert.doesNotMatch(reconciliation, /\[[^\]]*\bseats\b[^\]]*\]\);/);
});

test('组织版本重基失败时阻止保存并提供显式重新同步', async () => {
  const workspace = await fs.readFile(new URL('./OrganizationWorkspace.tsx', import.meta.url), 'utf8');
  const reconciliation = await fs.readFile(new URL('./useOrganizationSeatReconciliation.ts', import.meta.url), 'utf8');
  const canvas = await fs.readFile(new URL('./CycloneOrganizationCanvas.tsx', import.meta.url), 'utf8');
  assert.match(reconciliation, /reconcileFailed/);
  assert.match(reconciliation, /retry/);
  assert.match(workspace, /reconcilingSeats\.blocked/);
  assert.match(canvas, /onRetrySync/);
});

test('冷启动并行加载时等待当前工作室摘要就绪后再合并协作结构', async () => {
  const workspace = await fs.readFile(new URL('./OrganizationWorkspace.tsx', import.meta.url), 'utf8');
  const pane = await fs.readFile(new URL('../pages/CycloneWorkspacePane.tsx', import.meta.url), 'utf8');
  const page = await fs.readFile(new URL('../pages/CyclonePage.tsx', import.meta.url), 'utf8');
  assert.match(workspace, /summaryReady: boolean/);
  assert.match(workspace, /pendingOrganizationState/);
  assert.match(workspace, /pendingOrganizationState\.workshopId !== props\.workshopId/);
  assert.match(workspace, /createEditableOrganization\(pendingOrganizationState\.state, props\.seats\)/);
  assert.doesNotMatch(workspace, /createEditableOrganization\(state, seatsRef\.current\)/);
  assert.match(pane, /summaryReady=\{props\.workshopLoaded\}/);
  assert.match(page, /loadedWorkshopId === activeWid/);
});

test('协作结构接收当前工作室变更与重连信号，并在重新进入图页时校正', async () => {
  const workspace = await fs.readFile(new URL('./OrganizationWorkspace.tsx', import.meta.url), 'utf8');
  assert.match(workspace, /subscribeCycloneChanges\(event =>/);
  assert.match(workspace, /event\.type === 'sync'/);
  assert.match(workspace, /event\.workshopId === props\.workshopId && event\.scope === 'workshop'/);
  assert.match(workspace, /unsubscribe\(\)/);
  assert.match(workspace, /requestGuard\.current\.cancel\(\)/);
  assert.match(workspace, /subscribedWorkshopRef\.current === props\.workshopId/);
});

test('远端组织版本仅替换干净草稿，保存和乱序请求不能覆盖当前编辑', async () => {
  const workspace = await fs.readFile(new URL('./OrganizationWorkspace.tsx', import.meta.url), 'utf8');
  assert.match(workspace, /request\.isCurrent\(\)/);
  assert.match(workspace, /state\.organization\?\.revision === savedDraftRef\.current\.baseRevision/);
  assert.match(workspace, /synchronizeOrganizationDraft\(current, previousSaved, authoritative, props\.seats\)/);
  assert.match(workspace, /savingRef\.current/);
  assert.match(workspace, /deferredChangeRef\.current/);
  assert.match(workspace, /if \(!succeeded \|\| deferredChangeRef\.current\) void reload\(\)/);
  assert.match(workspace, /current === submittedDraft/);
  assert.match(workspace, /if \(selectedWorkshopRef\.current !== props\.workshopId\) return;/);
});

test('气旋普通拖动平移画布且只在按住 Shift 时框选工位', async () => {
  const canvas = await fs.readFile(new URL('./CycloneOrganizationCanvas.tsx', import.meta.url), 'utf8');
  assert.match(canvas, /panOnDrag/);
  assert.match(canvas, /selectionKeyCode="Shift"/);
  assert.doesNotMatch(canvas, /\n\s+selectionOnDrag\s*\n/);
});
