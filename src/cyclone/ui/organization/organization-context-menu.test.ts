import assert from 'node:assert/strict';
import test from 'node:test';
import { closeOrganizationMenu, openOrganizationMenu } from './organization-context-menu';

test('右键菜单明确区分空白、工位、集合与联络线', () => {
  assert.deepEqual(openOrganizationMenu('pane', 12, 24, null, { x: 3, y: 4 }), {
    kind: 'pane', x: 12, y: 24, id: null, flowPosition: { x: 3, y: 4 },
  });
  for (const kind of ['seat', 'group', 'relation'] as const) {
    assert.deepEqual(openOrganizationMenu(kind, 12, 24, 'target', null), {
      kind, x: 12, y: 24, id: 'target', flowPosition: null,
    });
  }
  assert.deepEqual(closeOrganizationMenu(), { kind: 'closed' });
});
