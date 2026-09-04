import assert from 'node:assert/strict';
import test from 'node:test';
import { relationHandles } from './relation-handles';

test('horizontal relations use the facing left and right handles', () => {
  assert.deepEqual(relationHandles({ x: 0, y: 0 }, { x: 300, y: 20 }), {
    sourceHandle: 'right', targetHandle: 'left',
  });
  assert.deepEqual(relationHandles({ x: 300, y: 20 }, { x: 0, y: 0 }), {
    sourceHandle: 'left', targetHandle: 'right',
  });
});

test('vertical relations use the facing top and bottom handles', () => {
  assert.deepEqual(relationHandles({ x: 0, y: 0 }, { x: 20, y: 300 }), {
    sourceHandle: 'bottom', targetHandle: 'top',
  });
  assert.deepEqual(relationHandles({ x: 20, y: 300 }, { x: 0, y: 0 }), {
    sourceHandle: 'top', targetHandle: 'bottom',
  });
});
