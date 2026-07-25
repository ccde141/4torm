import assert from 'node:assert/strict';
import test from 'node:test';
import {
  attachmentUrl,
  validateImageSelection,
} from './image-attachments.js';

test('图片选择只接受白名单类型、大小和数量', () => {
  assert.equal(validateImageSelection({ type: 'image/png', size: 1024 }, 0), undefined);
  assert.match(validateImageSelection({ type: 'image/svg+xml', size: 1024 }, 0) ?? '', /PNG/);
  assert.match(validateImageSelection({ type: 'image/png', size: 9 * 1024 * 1024 }, 0) ?? '', /8 MB/);
  assert.match(validateImageSelection({ type: 'image/png', size: 1 }, 4) ?? '', /4 张/);
});

test('附件地址对会话索引逐段编码', () => {
  assert.equal(
    attachmentUrl('agent-a', 'session-a', 'image 1'),
    '/api/conversation/attachments/agent-a/session-a/image%201',
  );
});
