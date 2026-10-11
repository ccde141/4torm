import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentValidationError, parseAgentPatch, parseCreateAgent } from './agent.js';

const createInput = {
  name: '测试 Agent', role: '', description: '', model: '', config: {},
};

test('Agent creation no longer accepts custom category labels', () => {
  assert.deepEqual(parseCreateAgent(createInput), createInput);
  assert.throws(() => parseCreateAgent({ ...createInput, label: 'label-old' }),
    AgentValidationError);
});

test('Agent updates reject legacy label writes without blocking other fields', () => {
  assert.deepEqual(parseAgentPatch({ name: '新名称' }), { name: '新名称' });
  assert.throws(() => parseAgentPatch({ label: 'label-old' }), AgentValidationError);
  assert.throws(() => parseAgentPatch({ label: null }), AgentValidationError);
});
