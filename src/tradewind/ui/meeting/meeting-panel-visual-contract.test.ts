import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const panel = fs.readFileSync('src/tradewind/ui/meeting/MeetingPanel.tsx', 'utf8');
const styles = fs.readFileSync('src/styles/components/tradewind-panels.css', 'utf8');

test('会议浮窗固定从公共会议进入并提供双会话侧栏', () => {
  assert.match(panel, /useState<MeetingView>\('public'\)/);
  assert.match(panel, /tw-meeting-panel__rail/);
  assert.match(panel, /公共会议/);
  assert.match(panel, /会议助理 私聊/);
});

test('公共会议与会议助理私聊切换时保持挂载', () => {
  assert.match(panel, /tw-meeting-panel__conversation--public/);
  assert.match(panel, /tw-meeting-panel__conversation--chair/);
  assert.doesNotMatch(panel, /activeView === 'public'\s*&&/);
  assert.doesNotMatch(panel, /activeView === 'chair'\s*&&/);
});

test('公共会议与会议助理私聊使用独立流式缓存', () => {
  assert.match(panel, /publicStreamRef/);
  assert.match(panel, /chairStreamRef/);
  assert.match(panel, /publicFrameDirtyRef/);
  assert.match(panel, /chairFrameDirtyRef/);
  assert.doesNotMatch(panel, /const streamRef = useRef/);
  assert.match(panel, /requestAnimationFrame/);
  assert.match(panel, /flushStreamFrame/);
  assert.match(panel, /case 'chair-token':\s*case 'chair-reasoning':/);
});

test('会议浮窗采用迷你季风的玻璃状态与输入形态', () => {
  assert.match(styles, /\.tw-meeting-panel__rail\s*\{/);
  assert.match(styles, /\.tw-meeting-panel__nav-item--active/);
  assert.match(styles, /\.tw-meeting-panel__composer/);
  assert.match(styles, /\.tw-meeting-panel__status/);
  assert.match(styles, /\.tw-meeting-msg--user[\s\S]*0 0 0 1px rgba\(255,\s*255,\s*255,\s*0\.28\)/);
});

test('会议浮窗只展示有语义的会话说明与空闲状态', () => {
  assert.match(panel, /会议助理的回复将会来自其对当前会议快照的审阅/);
  assert.match(panel, /const chairStateLabel =[^;]*'等待交流'/);
  assert.doesNotMatch(panel, /tw-meeting-panel__round/);
  assert.doesNotMatch(panel, /双会话独立保留|可以私聊/);
});
