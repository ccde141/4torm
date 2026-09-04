import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

test('气旋工位状态复用信风蓝色忙碌与绿色完成视觉参数', async () => {
  const css = await fs.readFile(new URL('./organization.css', import.meta.url), 'utf8');
  const shellCss = await fs.readFile(new URL('../../../styles/components/cyclone.css', import.meta.url), 'utf8');
  assert.match(css, /@keyframes cyclone-seat-busy-pulse/);
  assert.match(css, /59,\s*130,\s*246/);
  assert.match(css, /animation:\s*cyclone-seat-busy-pulse 1\.2s ease-in-out infinite/);
  assert.match(css, /@keyframes cyclone-seat-done-pop/);
  assert.match(css, /34,\s*197,\s*94/);
  assert.match(css, /animation:\s*cyclone-seat-done-pop 15s var\(--motion-emphasize-ease\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(shellCss, /prefers-reduced-motion[^]*cyclone-sidebar-status--running/);
});

test('组织图与信风只共享表现参数，不跨功能导入', async () => {
  const files = await Promise.all([
    'CycloneOrganizationCanvas.tsx', 'SeatNode.tsx', 'WorkGroupNode.tsx',
    'CollaborationEdge.tsx', 'OrganizationInspector.tsx',
  ].map(file => fs.readFile(new URL(`./${file}`, import.meta.url), 'utf8')));
  assert.doesNotMatch(files.join('\n'), /from ['"][^'"]*tradewind\//);
});

test('联络与派发使用自定义 SVG 光轨而非只切换基础边颜色', async () => {
  const edge = await fs.readFile(new URL('./CollaborationEdge.tsx', import.meta.url), 'utf8');
  const css = await fs.readFile(new URL('./organization.css', import.meta.url), 'utf8');
  assert.match(edge, /cyclone-org-edge__glow/);
  assert.match(edge, /<animateMotion/);
  assert.match(edge, /keyPoints=\{reverse \? '1;0' : '0;1'\}/);
  assert.match(edge, /type ActivityMode = 'contact' \| 'dispatch' \| 'return'/);
  assert.match(edge, /mode === 'dispatch'/);
  assert.match(edge, /mode === 'contact'/);
  assert.match(css, /cyclone-org-edge__particle--contact/);
  assert.match(css, /cyclone-org-edge__particle--dispatch/);
  assert.match(css, /prefers-reduced-motion[^]*cyclone-org-edge__activity/);
});

test('异步派发保持低注意力强度而不削弱同步联络', async () => {
  const edge = await fs.readFile(new URL('./CollaborationEdge.tsx', import.meta.url), 'utf8');
  const css = await fs.readFile(new URL('./organization.css', import.meta.url), 'utf8');
  assert.match(edge, /mode === 'dispatch' \? \['0s'\]/);
  assert.match(edge, /mode === 'dispatch' \? '2\.8s'/);
  assert.match(edge, /mode === 'contact' \? \['0s', '-0\.9s'\]/);
  assert.match(css, /activity--dispatch \.cyclone-org-edge__glow \{[^}]*opacity:\.18/);
  assert.match(css, /particle--dispatch \{[^}]*opacity:\.72/);
});

test('气旋画布提供与信风一致的深色视口控件和节点交互反馈', async () => {
  const canvas = await fs.readFile(new URL('./CycloneOrganizationCanvas.tsx', import.meta.url), 'utf8');
  const css = await fs.readFile(new URL('./organization.css', import.meta.url), 'utf8');
  assert.match(canvas, /<Controls[^>]*className="cyclone-org__controls"/);
  assert.match(canvas, /<MiniMap[^>]*className="cyclone-org__minimap"/);
  assert.match(css, /\.cyclone-org__controls button svg/);
  assert.match(css, /\.cyclone-org__minimap/);
  assert.match(css, /\.cyclone-org \.react-flow__node/);
  assert.match(css, /cursor:\s*grabbing/);
});

test('工位节点呈现组织身份并使用四个无方向连接点', async () => {
  const node = await fs.readFile(new URL('./SeatNode.tsx', import.meta.url), 'utf8');
  const css = await fs.readFile(new URL('./organization.css', import.meta.url), 'utf8');
  assert.match(node, /<AgentAvatar/);
  assert.match(node, /data\.duty/);
  for (const position of ['Top', 'Right', 'Bottom', 'Left']) {
    assert.match(node, new RegExp(`Position\\.${position}`));
  }
  assert.doesNotMatch(node, /type="target"/);
  assert.match(css, /\.cyclone-org-seat:hover \.cyclone-org-handle/);
});

test('协作组使用浅色区域与独立顶部标识条强化集合层级', async () => {
  const group = await fs.readFile(new URL('./WorkGroupNode.tsx', import.meta.url), 'utf8');
  const css = await fs.readFile(new URL('./organization.css', import.meta.url), 'utf8');
  assert.match(group, /cyclone-org-group__marker/);
  assert.match(css, /\.cyclone-org-group \{[^}]*border:[^;]*rgba\(148,163,184/);
  assert.match(css, /\.cyclone-org-group \{[^}]*background:rgba\(15,23,42/);
  assert.match(css, /\.cyclone-org-group__marker \{[^}]*width:100%[^}]*height:1px/);
  assert.match(css, /\.cyclone-org-group__marker \{[^}]*background:rgba\(/);
  assert.match(css, /\.cyclone-org-group--selected \.cyclone-org-group__marker \{[^}]*background:var\(--color-accent\)/);
  assert.match(css, /\.cyclone-org-group header \{[^}]*font-weight:700/);
});

test('画布禁用绕过气旋领域规则的原生删除与重连', async () => {
  const canvas = await fs.readFile(new URL('./CycloneOrganizationCanvas.tsx', import.meta.url), 'utf8');
  assert.match(canvas, /deleteKeyCode=\{null\}/);
  assert.match(canvas, /edgesReconnectable=\{false\}/);
  assert.match(canvas, /isValidConnection=/);
});

test('画布提供缩放坐标正确的空白、工位、集合与联络线右键入口', async () => {
  const canvas = await fs.readFile(new URL('./CycloneOrganizationCanvas.tsx', import.meta.url), 'utf8');
  assert.match(canvas, /screenToFlowPosition/);
  assert.match(canvas, /onPaneContextMenu=/);
  assert.match(canvas, /onNodeContextMenu=/);
  assert.match(canvas, /onEdgeContextMenu=/);
  assert.match(canvas, /<OrganizationContextMenu/);
});

test('拖动帧保留在本地节点状态且只在结束时提交组织草稿', async () => {
  const canvas = await fs.readFile(new URL('./CycloneOrganizationCanvas.tsx', import.meta.url), 'utf8');
  assert.match(canvas, /useNodesState/);
  assert.match(canvas, /onNodeDragStart=/);
  assert.match(canvas, /commitOrganizationNodePositions/);
});
