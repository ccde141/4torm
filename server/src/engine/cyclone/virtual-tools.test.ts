import assert from 'node:assert/strict';
import test from 'node:test';
import { buildContactVirtualToolDefs, buildSeatVirtualToolDefs } from './virtual-tools.js';

test('群聊新增异步 dispatch 但仍不提供 ask 与 delegate', () => {
  const names = buildSeatVirtualToolDefs({
    allowAsk: false,
    allowDelegate: false,
    allowDispatch: true,
    allowTaskBoard: false,
    contactTargets: [{ title: '后端', duty: '实现接口' }],
  }).map(tool => tool.name);

  assert.equal(names.includes('dispatch'), true);
  assert.equal(names.includes('contact'), true);
  assert.equal(names.includes('ask'), false);
  assert.equal(names.includes('delegate'), false);
  assert.equal(names.includes('task_board'), false);
});

test('工位私聊同时提供异步 dispatch 与原有协作工具', () => {
  const names = buildSeatVirtualToolDefs({
    allowAsk: true,
    allowDelegate: true,
    allowDispatch: true,
    allowToolRegistration: true,
    contactTargets: [{ title: '后端', duty: '实现接口' }],
  }).map(tool => tool.name);

  assert.equal(names.includes('dispatch'), true);
  assert.equal(names.includes('contact'), true);
  assert.equal(names.includes('ask'), true);
  assert.equal(names.includes('delegate'), true);
  assert.equal(names.includes('register_tool'), true);
  assert.equal(names.includes('task_board'), true);
});

test('临时子 Agent 的说明让位于跨工位持续任务', () => {
  const tools = buildSeatVirtualToolDefs({
    allowDispatch: true,
    dispatchTargets: [{ title: '后端', duty: '实现接口' }],
  });
  const delegate = tools.find(tool => tool.name === 'delegate');
  assert.match(delegate?.description || '', /本工位职责内/);
  assert.match(delegate?.description || '', /跨工位职责.*dispatch/);
  assert.doesNotMatch(delegate?.description || '', /2个以上文件时优先/);
});

test('气旋群聊与无人联络回合不提供工具注册', () => {
  const names = buildSeatVirtualToolDefs({
    allowAsk: false,
    allowDelegate: true,
    allowToolRegistration: false,
  }).map(tool => tool.name);
  assert.equal(names.includes('register_tool'), false);
});

test('群聊同步联络排除自己，但异步派发允许选择自己的固定工位', () => {
  const tools = buildSeatVirtualToolDefs({
    allowAsk: false,
    allowDelegate: false,
    allowDispatch: true,
    contactTargets: [{ title: '后端', duty: '实现接口' }],
    dispatchTargets: [
      { title: '架构', duty: '维护总体设计' },
      { title: '后端', duty: '实现接口' },
    ],
  });
  const contact = tools.find(tool => tool.name === 'contact');
  const dispatch = tools.find(tool => tool.name === 'dispatch');

  assert.match(contact?.description || '', /后端/);
  assert.doesNotMatch(contact?.description || '', /架构/);
  assert.match(dispatch?.description || '', /架构/);
  assert.match(dispatch?.description || '', /后端/);
});

test('被联络轮次只提供可执行的固定工位协作工具', () => {
  const names = buildContactVirtualToolDefs([]).map(tool => tool.name);
  assert.equal(names.includes('bulletin'), true);
  assert.equal(names.includes('delegate'), true);
  assert.equal(names.includes('task_board'), false);
  assert.equal(names.includes('ask'), false);
});

test('工位私聊和群聊只向 Agent 描述公告读取与新增', () => {
  for (const opts of [{}, { allowAsk: false, allowDelegate: false }]) {
    const bulletin = buildSeatVirtualToolDefs(opts).find(tool => tool.name === 'bulletin');
    assert.ok(bulletin);
    const action = bulletin.parameters?.properties?.action?.description || '';
    assert.match(action, /get=读取/);
    assert.match(action, /add=新增/);
    assert.doesNotMatch(action, /update|remove/);
    assert.equal(bulletin.parameters?.properties?.id, undefined);
  }
});
