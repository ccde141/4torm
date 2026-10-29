import assert from 'node:assert/strict';
import test from 'node:test';
import type { ToolDef } from '../../store/tools.js';
import { canEditCatalogTool, groupCatalogTools } from './tool-catalog-groups.js';

function framework(name: string, capability?: ToolDef['frameworkCapability']): ToolDef {
  return { name, description: name, category: 'system', dangerous: false,
    executorType: 'builtin', parameters: {}, source: 'framework', readonly: true,
    ...(capability ? { frameworkCapability: capability } : {}) };
}

test('new server capability identities group automatically in their first-seen order', () => {
  const future = { id: 'future-area', title: '新增能力', route: '新增场景' };
  const cyclone = { id: 'cyclone', title: '气旋协作组', route: '项目协作' };
  const first = framework('future_read', future), ordinary = framework('read_file');
  const second = framework('cyclone_start', cyclone), last = framework('future_write', future);
  const input = [first, ordinary, second, last];
  const before = structuredClone(input);
  const result = groupCatalogTools(input);
  assert.deepEqual(result.capabilities.map(group => group.id), ['future-area', 'cyclone']);
  assert.deepEqual(result.capabilities[0].tools, [first, last]);
  assert.deepEqual(result.capabilities[1].tools, [second]);
  assert.deepEqual(result.standalone, [ordinary]);
  assert.deepEqual(input, before);
});

test('names and untrusted custom metadata cannot impersonate a framework capability', () => {
  const capability = { id: 'tradewind', title: '信风工作流', route: '编排' };
  const trusted = framework('workflow_read', capability);
  const custom: ToolDef = { ...framework('custom_spoof', capability), source: 'custom',
    readonly: false, category: 'custom', executorType: 'custom' };
  const old = { ...framework('legacy_spoof', capability), source: undefined };
  const nameOnly = framework('tradewind_start');
  const result = groupCatalogTools([custom, trusted, old, nameOnly]);
  assert.deepEqual(result.capabilities.map(group => group.tools), [[trusted]]);
  assert.deepEqual(result.standalone, [custom, old, nameOnly]);
  const all = [...result.capabilities.flatMap(group => group.tools), ...result.standalone];
  assert.equal(all.length, 4);
  assert.equal(new Set(all.map(tool => tool.name)).size, 4);
});

test('editing requires both explicit custom ownership and explicit edit permission', () => {
  assert.equal(canEditCatalogTool({ source: 'custom', readonly: false }), true);
  for (const value of [
    { source: 'framework', readonly: false }, { source: 'framework', readonly: true },
    { source: 'custom', readonly: true }, { source: 'custom' }, { readonly: false }, {},
  ] satisfies Array<Pick<ToolDef, 'source' | 'readonly'>>) {
    assert.equal(canEditCatalogTool(value), false);
  }
});

test('empty catalogs stay empty without introducing configurable placeholder groups', () => {
  assert.deepEqual(groupCatalogTools([]), { capabilities: [], standalone: [] });
});
