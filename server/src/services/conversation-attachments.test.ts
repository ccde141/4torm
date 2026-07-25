import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  deleteConversationAttachments,
  readConversationAttachment,
  resolveConversationImages,
  saveConversationAttachment,
} from './conversation-attachments.js';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

test('会话附件使用稳定索引落盘并可解析为模型图片', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-images-'));
  const ref = await saveConversationAttachment(dataDir, 'agent-a', 'session-a', {
    name: 'screen.png', mimeType: 'image/png', dataUrl: PNG,
  });

  assert.equal(ref.name, 'screen.png');
  assert.equal(ref.mimeType, 'image/png');
  const stored = await readConversationAttachment(dataDir, 'agent-a', 'session-a', ref.id);
  assert.equal(stored.mimeType, 'image/png');
  assert.deepEqual(stored.data, Buffer.from('iVBORw0KGgo=', 'base64'));
  assert.deepEqual(await resolveConversationImages(dataDir, 'agent-a', 'session-a', [ref]), [{
    ...ref, dataUrl: PNG,
  }]);

  await deleteConversationAttachments(dataDir, 'agent-a', 'session-a');
  await assert.rejects(readConversationAttachment(dataDir, 'agent-a', 'session-a', ref.id));
});

test('会话附件拒绝越界标识、非图片与伪造 data URL', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-images-invalid-'));
  await assert.rejects(
    saveConversationAttachment(dataDir, '../agent', 'session-a', {
      name: 'screen.png', mimeType: 'image/png', dataUrl: PNG,
    }), /标识/,
  );
  await assert.rejects(
    saveConversationAttachment(dataDir, 'agent-a', 'session-a', {
      name: 'note.svg', mimeType: 'image/svg+xml', dataUrl: 'data:image/svg+xml;base64,AAAA',
    }), /图片类型/,
  );
  await assert.rejects(
    saveConversationAttachment(dataDir, 'agent-a', 'session-a', {
      name: 'screen.png', mimeType: 'image/png', dataUrl: 'data:image/jpeg;base64,AAAA',
    }), /data URL/,
  );
});
