import assert from 'node:assert/strict';
import test from 'node:test';
import type { CycloneDispatch } from './dispatch-timeline.js';
import {
  dispatchesRequiringSeatReload,
  findActiveSeatDispatch,
  formatSeatDispatchActivity,
  formatSeatDispatchOrigin,
  hasStoredDispatchInput,
  seatReceiptsRequiringReload,
} from './seat-dispatch-activity.js';
import fs from 'node:fs';
import { contextToDisplay } from './messageDisplay.js';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LocaleProvider } from '../../../i18n/LocaleContext.js';
import SeatDispatchActivity from './SeatDispatchActivity.js';

function dispatch(id: string, status: CycloneDispatch['status']): CycloneDispatch {
  return {
    id, workshopId: 'work-a', sourceRoomId: 'room-a', sourceSeatId: 'seat-a',
    sourceSeatTitle: '调度', sourceTurnId: 'turn-a', sourceRoundSeq: 1,
    dispatchOrder: 0, targetSeatId: 'seat-b', targetSeatTitle: '执行', task: id,
    status, readState: 'unread', decisionState: 'pending',
    createdAt: `2026-01-01T00:00:0${id.length}.000Z`, updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

test('目标工位优先显示正在执行的派发及具体工具目标', () => {
  const queued = dispatch('queued', 'queued');
  const running = {
    ...dispatch('running', 'running'),
    activity: { phase: 'tool-exec' as const, tool: 'write_file', target: 'src/app.ts' },
  };
  const active = findActiveSeatDispatch([queued, running], 'seat-b');
  assert.equal(active?.id, 'running');
  assert.deepEqual(formatSeatDispatchActivity(active!), {
    label: '正在执行 write_file', target: 'src/app.ts',
  });
});

test('派发完成、失败或等待回答时只触发对应工位重载', () => {
  const previous = new Map<string, CycloneDispatch['status']>([
    ['done', 'running'], ['ask', 'running'], ['old', 'completed'],
  ]);
  const items = [
    dispatch('done', 'completed'),
    dispatch('ask', 'awaiting_human'),
    dispatch('old', 'completed'),
    { ...dispatch('other', 'completed'), targetSeatId: 'seat-c' },
  ];
  assert.deepEqual(dispatchesRequiringSeatReload(previous, items, 'seat-b'), ['done', 'ask']);
});

test('源工位在回报待投递时即可刷新当前输入，不等待回执已经消费', () => {
  const item = { ...dispatch('outbound', 'completed'), sourceKind: 'seat' as const,
    receiptState: 'pending' as const, response: '核验完成' };
  const before = new Map<string, CycloneDispatch['status']>([[item.id, 'running']]);
  assert.equal(seatReceiptsRequiringReload(before, [item], 'seat-a'), true);
  assert.equal(seatReceiptsRequiringReload(before, [item], 'seat-c'), false);
  before.set(item.id, item.status);
  assert.equal(seatReceiptsRequiringReload(before, [item], 'seat-a'), false);
  assert.equal(seatReceiptsRequiringReload(before, [{ ...item, status: 'failed' }], 'seat-a'), true);
});

test('目标工位能区分群聊派发与工位私聊派发', () => {
  assert.equal(formatSeatDispatchOrigin(dispatch('room', 'running')), '来自群聊工位');
  assert.equal(formatSeatDispatchOrigin({
    ...dispatch('seat', 'running'), sourceKind: 'seat', sourceRoomId: '',
  }), '来自工位');
});

test('目标工位把 dispatch 外部活动接入实时回合', () => {
  const source = fs.readFileSync('src/cyclone/ui/pages/SeatChat.tsx', 'utf8');
  assert.match(source, /projectPrivateChatLive\(\{[\s\S]*legacy: externalActivity/);
});

test('已落盘的派发入站接管任务占位，回执和其他派发不能冒充该入站', () => {
  const history = contextToDisplay([
    { role: 'user', content: '相同任务', dispatchId: 'dispatch-earlier' },
    { role: 'user', content: '相同任务', dispatchId: 'dispatch-current' },
    { role: 'system', content: '已完成', kind: 'dispatch-receipt', dispatchId: 'dispatch-outbound' },
  ]);
  assert.equal(history[1].dispatchId, 'dispatch-current');
  assert.equal(hasStoredDispatchInput(history, 'dispatch-current'), true);
  assert.equal(hasStoredDispatchInput(history, 'dispatch-waiting'), false);
  assert.equal(hasStoredDispatchInput(history, 'dispatch-outbound'), false);
  assert.equal(hasStoredDispatchInput(contextToDisplay([{ role: 'user', content: '相同任务' }]),
    'dispatch-current'), false);
});

test('任务入站落盘后不再渲染第二条气泡，执行状态仍然可见', () => {
  const item = { ...dispatch('current', 'running'), task: '核验交付文件',
    activity: { phase: 'model-output' as const } };
  const render = (showInput: boolean) => renderToStaticMarkup(createElement(LocaleProvider, null,
    createElement(SeatDispatchActivity, { item, showInput })));
  const waiting = render(true);
  assert.match(waiting, /核验交付文件/);
  const accepted = render(false);
  assert.doesNotMatch(accepted, /核验交付文件|chat__message--user/);
  assert.match(accepted, /role="status"/);
  assert.match(accepted, /模型正在生成/);
});
