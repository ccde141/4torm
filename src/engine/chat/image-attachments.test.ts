import assert from 'node:assert/strict';
import test from 'node:test';
import {
  attachmentUrl,
  attachmentPreviewUrl,
  deleteConversationAttachment,
  validateImageSelection,
} from './image-attachments.js';

test('图片选择只接受白名单类型、大小和数量', () => {
  assert.equal(validateImageSelection({ type: 'image/png', size: 1024 }, 0), undefined);
  assert.match(validateImageSelection({ type: 'image/svg+xml', size: 1024 }, 0) ?? '', /PNG/);
  assert.match(validateImageSelection({ type: 'image/png', size: 9 * 1024 * 1024 }, 0) ?? '', /8 MB/);
  assert.match(validateImageSelection({ type: 'image/png', size: 1 }, 4) ?? '', /4 张/);
});

test('单附件删除只请求对应会话中的对应附件', async () => {
  let requested = '';
  await deleteConversationAttachment('agent-a', 'session-a', 'image 1', async input => {
    requested = String(input);
    return new Response('{}', { status: 200 });
  });
  assert.equal(requested, '/api/conversation/attachments/agent-a/session-a/image%201');
});

test('附件地址对会话索引逐段编码', () => {
  assert.equal(
    attachmentUrl('agent-a', 'session-a', 'image 1'),
    '/api/conversation/attachments/agent-a/session-a/image%201',
  );
});

test('附件预览使用同一归属地址并明确请求缩略图，原图地址不变', () => {
  const original = '/api/conversation/attachments/agent%2Fa/session%20a/image%3F1';
  assert.equal(attachmentUrl('agent/a', 'session a', 'image?1'), original);
  assert.equal(attachmentPreviewUrl('agent/a', 'session a', 'image?1'), `${original}?preview=1`);
});
