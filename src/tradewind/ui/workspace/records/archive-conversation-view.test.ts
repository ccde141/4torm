import assert from 'node:assert/strict';
import test from 'node:test';
import { archiveDisplay } from './archive-conversation-view';

test('公开归档工具图片保留结构化引用，不从内容文本猜测图片路径', () => {
  const toolImages = [{ id: 'shot-a', name: 'desktop.png', mimeType: 'image/png', size: 128 }];
  const display = archiveDisplay(JSON.stringify([{ role: 'tool', toolName: 'mcp:observe',
    content: 'metadata', toolImages }]), true, 'node-context', 'public-conversation');
  assert.equal(display.kind, 'messages');
  assert.deepEqual(display.kind === 'messages' ? display.items[0].toolImages : undefined, toolImages);
});

test('会话片段缺少公开内容标识时不显示原始系统上下文，交付读取保持兼容', () => {
  const text = '[{"role":"system","content":"PRIVATE_PROMPT';
  assert.deepEqual(archiveDisplay(text, false, 'node-context'), { kind: 'unavailable' });
  assert.deepEqual(archiveDisplay(text, false, 'meeting'), { kind: 'unavailable' });
  assert.deepEqual(archiveDisplay('实际交付', false, 'output'), { kind: 'fragment', text: '实际交付' });
});

test('已投影会话按消息或受限分片显示，系统角色不能生成消息卡片', () => {
  const text = JSON.stringify([{ role: 'system', content: 'system' }, { role: 'user', content: '人类问题' },
    { role: 'assistant', content: '实际回复' }, { role: 'tool', toolName: 'read_file', content: '实际结果' }]);
  const view = archiveDisplay(text, true, 'node-context', 'public-conversation');
  assert.equal(view.kind, 'messages');
  if (view.kind === 'messages') assert.deepEqual(view.items.map(item => item.role), ['user', 'assistant', 'tool']);
  const fragment = '[{"role":"assistant","content":"可见';
  assert.deepEqual(archiveDisplay(fragment, false, 'node-context', 'public-conversation'), { kind: 'fragment', text: fragment });
});
