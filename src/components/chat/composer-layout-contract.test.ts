import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (file: string) => fs.readFileSync(file, 'utf8');

test('taskboard drawer stays above the shared composer layer', () => {
  const drawer = read('src/components/chat/TaskBoardDrawer.tsx');
  assert.match(drawer, /const drawerStyle:[\s\S]*zIndex: 12/);
});

test('taskboard keeps its collapse control reachable at narrow drawer widths', () => {
  const drawer = read('src/components/chat/TaskBoardDrawer.tsx');
  const styles = read('src/styles/components/chat.css');
  const chat = read('src/components/chat/ChatPage.tsx');
  const cycloneSeat = read('src/cyclone/ui/pages/SeatChat.tsx');

  assert.match(drawer, /taskboard-header__primary/);
  assert.match(drawer, /taskboard-header__collapse/);
  assert.match(drawer, /taskboard-header__toolbar/);
  assert.match(styles, /\.taskboard-header\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) auto/);
  assert.match(styles, /\.taskboard-header__toolbar\s*\{[\s\S]*grid-column:\s*1 \/ -1[\s\S]*flex-wrap:\s*wrap/);
  assert.match(chat, /<TaskBoardDrawer/);
  assert.match(cycloneSeat, /<TaskBoardDrawer/);
});

test('execution observations open in a responsive overlay while the taskboard stays visible', () => {
  const drawer = read('src/components/chat/TaskBoardDrawer.tsx');
  const overlay = read('src/components/chat/ExecutionSurfaceOverlay.tsx');

  assert.match(drawer, /ExecutionSurfaceOverlay/);
  assert.match(drawer, /executionSurfaceReducer/);
  assert.match(drawer, /type: 'reconcile'/);
  assert.match(drawer, /type: 'reset-owner'/);
  assert.match(drawer, /terminateObservation/);
  assert.match(drawer, /closingObservation/);
  assert.match(drawer, /getExecutionSurfaceCapability/);
  assert.doesNotMatch(drawer, /const browser =/);
  assert.match(drawer, /reservedRight={RAIL_W}/);
  assert.match(overlay, /ExecutionSurfaceViewport/);
  assert.match(overlay, /getExecutionSurfaceCapability/);
  assert.doesNotMatch(overlay, /selected\.viewer === 'browser'/);
  assert.match(overlay, /onTerminate/);
  assert.match(overlay, /onCloseTab/);
  assert.match(overlay, /onClick=\{\(\) => onCloseTab\(item\.id\)\}/);
  assert.match(overlay, /onClick=\{\(\) => onTerminate\(selected\.id\)\}/);
  assert.match(overlay, /closingId/);
  assert.match(overlay, /background: 'rgba\(220, 38, 38, 0\.16\)'/);
  assert.match(overlay, /role="dialog"/);
  assert.match(overlay, /reservedRight/);
  assert.match(overlay, /width: 'min\(70vw, 1180px\)'/);
});

test('taskboard exposes a fixed shortcut to the current execution surface', () => {
  const drawer = read('src/components/chat/TaskBoardDrawer.tsx');

  assert.match(drawer, /selectCurrentExecutionSurface/);
  assert.match(drawer, /currentExecution/);
});

test('execution surfaces reuse the centralized motion vocabulary', () => {
  const overlay = read('src/components/chat/ExecutionSurfaceOverlay.tsx');
  const native = read('src/components/chat/NativeObservationView.tsx');
  const drawer = read('src/components/chat/TaskBoardDrawer.tsx');
  const styles = read('src/styles/components/chat.css');

  assert.match(overlay, /execution-surface-backdrop/);
  assert.match(overlay, /execution-surface-panel/);
  assert.match(native, /execution-surface-loading/);
  assert.match(drawer, /taskboard-execution-row/);
  assert.match(styles, /\.execution-surface-panel[\s\S]*var\(--motion-modal-duration\)[\s\S]*var\(--motion-modal-ease\)/);
  assert.match(styles, /\.execution-surface-loading[\s\S]*var\(--motion-loop-duration\)[\s\S]*var\(--motion-loop-ease\)/);
  assert.match(read('src/styles/index.css'), /prefers-reduced-motion: reduce/);
});

test('execution surface controls use clear Chinese labels and shared button styling', () => {
  const overlay = read('src/components/chat/ExecutionSurfaceOverlay.tsx');
  const native = read('src/components/chat/NativeObservationView.tsx');
  const visual = read('src/components/chat/VisualObservationView.tsx');
  const terminal = read('src/components/chat/TerminalObservationView.tsx');
  const drawer = read('src/components/chat/TaskBoardDrawer.tsx');
  const capability = read('src/components/chat/execution-surface-capability.ts');

  for (const source of [overlay, native, visual, terminal, drawer, capability]) {
    assert.doesNotMatch(source, /执行现场|Close tab|Take control|Return to Agent|Human control|Agent control/);
  }
  assert.match(overlay, /aria-label="运行窗口"/);
  assert.match(overlay, /className="execution-surface-action/);
  assert.match(native, /Agent 操作中|人类操作中/);
  assert.match(native, /交由人类操作|交还 Agent 操作/);
  assert.match(visual, /className="execution-surface-action"/);
  assert.match(drawer, /运行视图/);
  assert.match(drawer, /execution-surface-shortcut__icon/);
  assert.match(drawer, /execution-surface-shortcut__status/);
});

test('visual execution views share owner-safe polling and control semantics', () => {
  const native = read('src/components/chat/NativeObservationView.tsx');
  const visual = read('src/components/chat/VisualObservationView.tsx');
  const hook = read('src/components/chat/useVisualObservation.ts');

  assert.match(native, /useVisualObservation/);
  assert.match(visual, /useVisualObservation/);
  assert.doesNotMatch(native, /fetch\(/);
  assert.doesNotMatch(visual, /fetch\(/);
  assert.match(hook, /requestKeyRef/);
  assert.match(hook, /loaded\?\.requestKey === requestKey/);
  assert.match(hook, /failure\?\.requestKey === requestKey/);
  assert.match(hook, /refreshActiveObservation/);
});

test('conversation and cyclone composers reset height after a programmatic clear', () => {
  for (const file of [
    'src/components/chat/ChatPage.tsx',
    'src/cyclone/ui/pages/SeatChat.tsx',
    'src/cyclone/ui/pages/RoomComposer.tsx',
  ]) {
    assert.match(read(file), /style\.removeProperty\('height'\)/, file);
  }
});

test('both convection composers reset height after sending', () => {
  const page = read('src/convection/ui/pages/ConvectionPage.tsx');
  assert.match(page, /inputRef\.current\?\.style\.removeProperty\('height'\)/);
  assert.match(page, /cInputRef\.current\?\.style\.removeProperty\('height'\)/);
});
