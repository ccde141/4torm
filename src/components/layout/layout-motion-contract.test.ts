import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (file: string) => fs.readFileSync(file, 'utf8');

test('the global sidebar collapses to a persistent accessible rail', () => {
  const app = read('src/App.tsx');
  const sidebar = read('src/components/layout/Sidebar.tsx');
  const styles = read('src/styles/components/sidebar.css');

  assert.match(app, /useState\(false\)/);
  assert.match(app, /collapsed={sidebarCollapsed}/);
  assert.match(sidebar, /aria-controls="app-sidebar-navigation"/);
  assert.match(sidebar, /aria-expanded={!collapsed}/);
  assert.match(sidebar, /className="sidebar__body"/);
  assert.match(sidebar, /inert={collapsed}/);
  assert.doesNotMatch(sidebar, /!collapsed && <nav/);
  assert.match(sidebar, /收起功能区|展开功能区/);
  assert.match(styles, /sidebar--collapsed/);
  assert.match(styles, /\.sidebar__body[\s\S]*width: var\(--sidebar-width\)/);
  assert.match(styles, /\.sidebar__toggle[\s\S]*background: transparent/);
  assert.match(styles, /--sidebar-collapsed-width/);
});

test('approved shared controls animate explicit properties only', () => {
  const sidebar = read('src/styles/components/sidebar.css');
  const header = read('src/styles/components/header.css');
  const sessions = read('src/styles/components/session-list.css');
  const chat = read('src/styles/components/chat.css');
  const global = read('src/styles/index.css');

  for (const source of [sidebar, header, sessions]) assert.doesNotMatch(source, /transition:\s*all/);
  assert.doesNotMatch(chat, /\.chat__send-btn\s*\{[\s\S]*?transition:\s*all/);
  assert.doesNotMatch(chat, /\.chat__stop-btn\s*\{[\s\S]*?transition:\s*all/);
  assert.doesNotMatch(global, /\.icon-add-btn\s*\{[\s\S]*?transition:\s*all/);
});

test('shared icon controls expose Chinese accessible names', () => {
  const header = read('src/components/layout/Header.tsx');
  const chat = read('src/components/chat/ChatPage.tsx');
  const cyclone = read('src/cyclone/ui/pages/CyclonePage.tsx');
  const tide = read('src/tide/ui/TidePage.tsx');

  assert.match(header, /aria-label="打开皮肤设置"/);
  assert.match(chat, /aria-label="新建会话"/);
  assert.match(cyclone, /aria-label="新建工作室"/);
  assert.match(tide, /aria-label="新增自动化任务"/);
});

test('feature navigation names the feature before its managed object', () => {
  const app = read('src/App.tsx');
  const sidebar = read('src/components/layout/Sidebar.tsx');

  for (const label of ['季风 · 对话', '对流 · 会议室', '气旋 · 工作室', '信风 · 工作流', '潮汐 · 自动化任务']) {
    assert.ok(app.includes(label), `missing page title: ${label}`);
    assert.ok(sidebar.includes(label), `missing navigation label: ${label}`);
  }
});

test('convection and cyclone list cards expose a real primary button', () => {
  const convection = read('src/convection/ui/pages/ConvectionPage.tsx');
  const cyclone = read('src/cyclone/ui/pages/CyclonePage.tsx');
  const styles = read('src/styles/components/convection.css');

  assert.match(convection, /className="conv__session-card-main"/);
  assert.doesNotMatch(convection, /<div key={s\.id} onClick/);
  assert.match(cyclone, /style={itemMainStyle}/);
  assert.doesNotMatch(cyclone, /<div key={w\.id} onClick|<div key={s\.id} onClick|<div key={rm\.id} onClick/);
  assert.match(styles, /\.conv__session-card[\s\S]*background: var\(--glass-bg\)/);
  assert.match(styles, /border-radius: var\(--border-radius-md\)/);
  assert.match(styles, /\.conv__sidebar[\s\S]*width: 240px/);
  assert.match(styles, /\.conv__sessions[\s\S]*padding: 0 var\(--space-3\) var\(--space-3\)/);
  assert.match(convection, /conv__sidebar-title">会议室</);
});

test('approved modal controls avoid broad transitions and name icon actions', () => {
  for (const file of [
    'src/styles/components/config-modal.css',
    'src/styles/components/bg-config-modal.css',
    'src/styles/components/memory-panel.css',
    'src/styles/components/skin-panel.css',
    'src/styles/components/skin-custom.css',
  ]) assert.doesNotMatch(read(file), /transition:\s*all/, file);

  assert.match(read('src/components/agents/AgentConfigModal.tsx'), /aria-label="关闭 Agent 配置"/);
  assert.match(read('src/components/agents/MemoryPanel.tsx'), /aria-label="关闭长期记忆"/);
  assert.match(read('src/components/chat/MessageItem.tsx'), /aria-label="编辑消息"/);
  assert.match(read('src/cyclone/ui/pages/ChairDrawer.tsx'), /aria-label="收起会长私聊"/);
});
