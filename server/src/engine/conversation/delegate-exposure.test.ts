import assert from 'node:assert/strict';
import test from 'node:test';
import { buildVirtualToolDefs } from './virtual-tools.js';

test('底层保留 delegate 能力且允许季风显式关闭', () => {
  const visible = buildVirtualToolDefs(true, { allowDelegate: false }).map(tool => tool.name);
  assert.ok(!visible.includes('delegate'));
  assert.ok(visible.includes('ask'));
  assert.ok(buildVirtualToolDefs().some(tool => tool.name === 'delegate'));
});
