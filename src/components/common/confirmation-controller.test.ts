import assert from 'node:assert/strict';
import test from 'node:test';
import { createConfirmationController, type ConfirmationState } from './confirmation-controller';

function fixture() {
  const states: Array<ConfirmationState<string> | null> = [];
  const exits: Array<() => void> = [];
  const controller = createConfirmationController<string>(state => states.push(state), callback => {
    exits.push(callback);
    return () => {};
  });
  return { controller, states, exits };
}

test('重复请求不会覆盖待确认对象，取消不会批准任何操作', async () => {
  const { controller, states } = fixture();
  const first = controller.request('first');
  assert.equal(await controller.request('second'), false);
  assert.equal(states.at(-1)?.options, 'first');
  controller.settle(false);
  assert.equal(await first, false);
});

test('确认只结算一次，旧退场回调不会清掉紧接着打开的确认', async () => {
  const { controller, states, exits } = fixture();
  const first = controller.request('first');
  controller.settle(true);
  controller.settle(false);
  assert.equal(await first, true);
  const second = controller.request('second');
  exits[0]();
  assert.equal(states.at(-1)?.options, 'second');
  controller.settle(false);
  assert.equal(await second, false);
  exits[1]();
  assert.equal(states.at(-1), null);
});

test('卸载取消尚未确认的请求，重新挂载可继续使用', async () => {
  const { controller, states, exits } = fixture();
  const pending = controller.request('old');
  controller.dispose();
  assert.equal(await pending, false);
  assert.equal(await controller.request('unmounted'), false);
  controller.activate();
  assert.equal(states.at(-1), null);
  const next = controller.request('new');
  assert.equal(states.at(-1)?.options, 'new');
  controller.settle(true);
  controller.dispose();
  exits[0]();
  assert.equal(await next, true);
});
