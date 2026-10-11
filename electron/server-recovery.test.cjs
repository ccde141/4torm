const assert = require('node:assert/strict');
const test = require('node:test');
const { createServerRecovery } = require('./server-recovery.cjs');

test('unexpected server exit recovers once without replaying operations', async () => {
  let recoveries = 0;
  const recovery = createServerRecovery({
    recover: async () => { recoveries += 1; },
    onFailure: () => assert.fail('recovery should succeed'),
  });
  await recovery.handleExit();
  await recovery.handleExit();
  assert.equal(recoveries, 1);
});

test('normal application shutdown never restarts the server', async () => {
  const recovery = createServerRecovery({
    recover: async () => assert.fail('server must stay stopped'),
    onFailure: () => assert.fail('no failure should be reported'),
  });
  recovery.stop();
  await recovery.handleExit();
});

test('failed recovery is reported and never loops', async () => {
  const errors = [];
  let recoveries = 0;
  const recovery = createServerRecovery({
    recover: async () => { recoveries += 1; throw new Error('startup failed'); },
    onFailure: error => errors.push(error.message),
  });
  await recovery.handleExit();
  await recovery.handleExit();
  assert.deepEqual(errors, ['startup failed']);
  assert.equal(recoveries, 1);
});
