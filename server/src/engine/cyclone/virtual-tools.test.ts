import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSeatVirtualToolDefs } from './virtual-tools.js';

test('群聊新增异步 dispatch 但仍不提供 ask 与 delegate', () => {
  const names = buildSeatVirtualToolDefs({
    allowAsk: false,
    allowDelegate: false,
    allowDispatch: true,
    contactTargets: [{ title: '后端', duty: '实现接口' }],
  }).map(tool => tool.name);

  assert.equal(names.includes('dispatch'), true);
  assert.equal(names.includes('contact'), true);
  assert.equal(names.includes('ask'), false);
  assert.equal(names.includes('delegate'), false);
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
