import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCycloneActivityTarget } from './cyclone-activity-target.js';

test('气旋运行身份恢复所属工作室和具体工位，非法身份不被当成目标', () => {
  assert.deepEqual(parseCycloneActivityTarget('seat:workshop-a:seat-a'),
    { workshopId: 'workshop-a', kind: 'seat', id: 'seat-a' });
  assert.deepEqual(parseCycloneActivityTarget('room:workshop-a:room-a'),
    { workshopId: 'workshop-a', kind: 'room', id: 'room-a' });
  assert.deepEqual(parseCycloneActivityTarget('workshop-a'),
    { workshopId: 'workshop-a' });
  assert.equal(parseCycloneActivityTarget('seat:missing'), null);
});
