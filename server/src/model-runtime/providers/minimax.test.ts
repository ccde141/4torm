import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeChatRequestBody, resolveMaxOutputTokens, resolveRequestTemperature } from './request-normalization.js';

const source = { model: 'MiniMax-M3', messages: [], max_tokens: 4096, temperature: 0.7, stream: true };

test('MiniMax fixes split reasoning while inheriting model defaults', () => {
  const body = normalizeChatRequestBody({
    baseUrl: 'https://api.minimaxi.com/v1', model: 'MiniMax-M3', providerType: 'minimax',
  }, source);
  assert.equal(body.reasoning_split, true);
  assert.equal('thinking' in body, false);
});

test('MiniMax M3 consumes explicit sampling and thinking controls', () => {
  const identity = {
    baseUrl: 'https://api.minimaxi.com/v1', model: 'MiniMax-M3', providerType: 'minimax' as const,
    generationDefaults: {
      maxOutputTokens: 32768, temperature: 1.2, topP: 0.95, thinkingMode: 'disabled',
    },
  };
  const body = normalizeChatRequestBody(identity, source);
  assert.deepEqual(body.thinking, { type: 'disabled' });
  assert.equal(body.temperature, 1.2);
  assert.equal(body.top_p, 0.95);
  assert.equal(resolveMaxOutputTokens(identity), 32768);
  assert.equal(resolveRequestTemperature(identity), 1.2);
});

test('MiniMax M2.x refuses a thinking switch that the model cannot honor', () => {
  assert.throws(() => normalizeChatRequestBody({
    baseUrl: 'https://api.minimaxi.com/v1', model: 'MiniMax-M2.7', providerType: 'minimax',
    generationDefaults: { thinkingMode: 'disabled' },
  }, { ...source, model: 'MiniMax-M2.7' }), /thinkingMode.*仅适用于 MiniMax-M3/);
});
