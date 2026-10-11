import assert from 'node:assert/strict';
import test from 'node:test';
import type { CycloneWorkshopService } from '../application/workshop-service.js';
import { cycloneWorkshopHandlers } from './workshop-methods.js';

test('creating a seat accepts blank optional role and duty fields from the UI', () => {
  const handlers = cycloneWorkshopHandlers({} as CycloneWorkshopService);
  const parsed = handlers.addWorkshopSeat.parse({
    workshopId: 'cyc-1', agentId: 'agent-a', title: '前端验收',
    rolePrompt: '检查界面', duty: '', overrideAgentRole: false,
  });
  assert.deepEqual(parsed, {
    workshopId: 'cyc-1', agentId: 'agent-a', title: '前端验收',
    rolePrompt: '检查界面', overrideAgentRole: false,
  });
});

test('generating a duty accepts a blank optional role prompt', () => {
  const handlers = cycloneWorkshopHandlers({} as CycloneWorkshopService);
  assert.deepEqual(handlers.generateSeatDuty.parse({
    agentId: 'agent-a', title: '前端验收', rolePrompt: '',
  }), { agentId: 'agent-a', title: '前端验收' });
});
