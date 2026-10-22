import assert from 'node:assert/strict';
import test from 'node:test';
import { autoLayout } from './workflow-layout.js';
import { buildWorkflowGraph, type WorkflowSpec, type WorkflowSpecNode } from './workflow-spec.js';

function spec(ids: string[], pairs: string[][]): WorkflowSpec {
  return { name: '条件交接布局', orchestration: 'handoff',
    nodes: ids.map(id => ({ id, type: id.startsWith('in') ? 'entry'
      : id === 'out' ? 'output' : 'agent', label: id })),
    edges: pairs.map(([source, target]) => ({ source, target })) };
}

function positions(input: WorkflowSpec, existing?: Map<string, { x: number; y: number }>) {
  return new Map(buildWorkflowGraph(input, existing).nodes.map(node => [node.id, node.position]));
}

function leftToRight(actual: Map<string, { x: number; y: number }>, ids: string[]): void {
  for (let index = 1; index < ids.length; index++) {
    assert.ok(actual.get(ids[index - 1])!.x < actual.get(ids[index])!.x,
      `${ids[index - 1]} 应在 ${ids[index]} 左侧`);
  }
}

test('条件交接循环从入口开始布局，返工边完整保留而不拖回出口层级', () => {
  const input = spec(['out', 'review', 'make', 'in'],
    [['in', 'make'], ['make', 'review'], ['review', 'make'], ['review', 'out']]);
  const original = structuredClone(input);
  const graph = buildWorkflowGraph(input);
  leftToRight(new Map(graph.nodes.map(node => [node.id, node.position])), ['in', 'make', 'review', 'out']);
  assert.deepEqual(graph.edges.map(({ source, target }) => ({ source, target })), input.edges);
  assert.equal(new Set(graph.edges.map(edge => edge.id)).size, input.edges.length);
  assert.ok(graph.edges.every(edge => edge.kind === 'handoff'));
  assert.deepEqual(input, original, '布局只能投影，不能更改真实图定义');
});

test('双入口共享循环工作节点时，两个入口同层且出口仍在最右侧', () => {
  const input = spec(['review', 'in-b', 'out', 'make', 'in-a'],
    [['in-a', 'make'], ['in-b', 'make'], ['make', 'review'], ['review', 'make'], ['review', 'out']]);
  const actual = positions(input);
  assert.equal(actual.get('in-a')!.x, actual.get('in-b')!.x);
  assert.notEqual(actual.get('in-a')!.y, actual.get('in-b')!.y);
  leftToRight(actual, ['in-a', 'make', 'review', 'out']);
});

test('连续返工环与自环只影响画线，不使主路径节点退回第零层', () => {
  const input = spec(['in', 'a', 'b', 'c', 'out'],
    [['in', 'a'], ['a', 'b'], ['b', 'a'], ['b', 'c'], ['c', 'b'], ['c', 'c'], ['c', 'out']]);
  leftToRight(positions(input), ['in', 'a', 'b', 'c', 'out']);
  assert.equal(buildWorkflowGraph(input).edges.length, input.edges.length);
});

test('同一循环组的交叉边保留主路径层级，不能将黑色完成节点当作回边删除', () => {
  const input = spec(['in-a', 'in-b', 'a', 'b', 'c', 'out'],
    [['in-a', 'a'], ['a', 'out'], ['in-b', 'b'], ['b', 'c'], ['c', 'b'], ['c', 'a']]);
  leftToRight(positions(input), ['in-b', 'b', 'c', 'a', 'out']);
  assert.equal(buildWorkflowGraph(input).edges.length, input.edges.length);
});

test('Note不参与信封回路层级，其说明连线与配置完整保留', () => {
  const input = spec(['in', 'make', 'review', 'out'],
    [['in', 'make'], ['make', 'review'], ['review', 'make'], ['review', 'out']]);
  input.nodes.unshift({ id: 'note', type: 'note', label: '约定', content: '保留产品字段', targets: ['review'] });
  const graph = buildWorkflowGraph(input);
  leftToRight(new Map(graph.nodes.map(node => [node.id, node.position])), ['in', 'make', 'review', 'out']);
  assert.deepEqual(graph.edges.filter(edge => edge.kind === 'note').map(edge => [edge.source, edge.target]), [['note', 'review']]);
  assert.equal(graph.nodes.find(node => node.id === 'note')!.config.content, '保留产品字段');
  assert.ok(graph.nodes.every(node => Number.isFinite(node.position.x) && Number.isFinite(node.position.y)));
});

test('更新条件交接图沿用已有坐标，只为新增节点计算位置', () => {
  const input = spec(['in', 'make', 'review', 'out'],
    [['in', 'make'], ['make', 'review'], ['review', 'make'], ['review', 'out']]);
  const existing = new Map([['in', { x: 0, y: 0 }], ['make', { x: 45, y: 67 }], ['review', { x: 89, y: 101 }]]);
  const actual = positions(input, existing);
  for (const [nodeId, position] of existing) assert.deepEqual(actual.get(nodeId), position);
  assert.ok(Number.isFinite(actual.get('out')!.x));
});

test('旧无编排字段及严格模式继续使用原DAG布局，条件交接DAG结果也不漂移', () => {
  const input = spec(['in-a', 'in-b', 'a', 'b', 'out'],
    [['in-a', 'a'], ['in-b', 'b'], ['a', 'out'], ['b', 'out']]);
  const expected = autoLayout(input.nodes, input.edges);
  for (const orchestration of [undefined, 'strict', 'handoff'] as const) {
    assert.deepEqual(positions({ ...input, orchestration }), expected);
  }
});

test('未连接的草稿节点仍有有效位置，布局不能替代权威图校验', () => {
  const input = spec(['orphan', 'in', 'make', 'out'], [['in', 'make'], ['make', 'out']]);
  input.nodes.push({ id: 'isolated-note', type: 'note', label: '草稿备注' } satisfies WorkflowSpecNode);
  const actual = positions(input);
  assert.equal(actual.size, input.nodes.length);
  assert.ok([...actual.values()].every(position => Number.isFinite(position.x) && Number.isFinite(position.y)));
});
