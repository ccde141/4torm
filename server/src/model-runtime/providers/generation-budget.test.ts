import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveProviderGenerationBudget } from './generation-budget.js';
import { resolveProviderAdapter } from './registry.js';
import type { ProviderModelIdentity } from '../contracts/provider-adapter.js';

const requested = { maxContentTokens: 20_000, reasoningReserveTokens: 32_000 };
const deepseek: ProviderModelIdentity = {
  baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-v4-flash', providerType: 'deepseek',
};
const kimi: ProviderModelIdentity = {
  baseUrl: 'https://api.moonshot.ai/v1', model: 'kimi-k2.7-code', providerType: 'kimi',
};

test('summary content receives its own allowance while thinking receives extra request space', async () => {
  for (const identity of [deepseek, kimi]) {
    const budget = await resolveProviderGenerationBudget(identity, requested);
    assert.equal(budget.maxContentTokens, 20_000);
    assert.equal(budget.maxOutputTokens, 52_000);
    assert.ok(budget.inputTokens! > 100_000);
  }
  const unknown = await resolveProviderGenerationBudget({
    baseUrl: 'https://proxy.example.test/v1', model: 'unknown',
  }, requested);
  assert.deepEqual(unknown, { maxContentTokens: 20_000, maxOutputTokens: 52_000 });
  const unqualifiedDeepSeek = await resolveProviderGenerationBudget({
    ...deepseek, model: 'future-deepseek-model',
  }, requested);
  assert.deepEqual(unqualifiedDeepSeek, { maxContentTokens: 20_000, maxOutputTokens: 52_000 });
});

test('generation limits distinguish hard model capacities from ordinary output defaults', async () => {
  const identity = { ...deepseek, generationDefaults: { maxOutputTokens: 1024 } };
  assert.deepEqual(resolveProviderAdapter(identity).generationLimits?.(identity), {
    contextWindowTokens: 1_048_576, maxOutputTokens: 393_216, reasoning: true,
  });
  assert.equal((await resolveProviderGenerationBudget(identity, requested)).maxOutputTokens, 52_000);
  assert.deepEqual(resolveProviderAdapter(kimi).generationLimits?.(kimi), {
    contextWindowTokens: 262_144, reasoning: true,
  });
});

test('reasoning reserve follows normalized defaults and final custom thinking switches', async () => {
  const scenarios: Array<[ProviderModelIdentity, number]> = [
    [{ ...deepseek, generationDefaults: { thinkingMode: 'disabled' } }, 20_000],
    [{ ...deepseek, generationDefaults: { thinkingMode: 'disabled' },
      customRequestParameters: { thinking: { type: 'enabled' } } }, 52_000],
    [{ ...deepseek, customRequestParameters: { thinking: { type: 'disabled' } } }, 20_000],
    [{ ...deepseek, customRequestParameters: { reasoning_effort: 'none' } }, 20_000],
    [{ ...kimi, model: 'kimi-k2.6', generationDefaults: { thinkingMode: 'disabled' } }, 20_000],
    [{ ...kimi, model: 'kimi-k2.6', generationDefaults: { thinkingMode: 'disabled' },
      customRequestParameters: { thinking: { type: 'enabled' } } }, 52_000],
  ];
  for (const [identity, output] of scenarios) {
    assert.equal((await resolveProviderGenerationBudget(identity, requested)).maxOutputTokens, output);
  }
});

test('small observed contexts proportionally narrow output and leave safe input capacity', async () => {
  const budget = await resolveProviderGenerationBudget({
    baseUrl: 'http://local.test/v1', model: 'local', providerType: 'llama-cpp',
  }, requested, async () => new Response(JSON.stringify({
    default_generation_settings: { n_ctx: 8192 },
  })));
  assert.equal(budget.maxOutputTokens, 1945);
  assert.equal(budget.maxContentTokens, 748);
  assert.equal(budget.inputTokens, 5837);
  assert.ok(budget.inputTokens! + budget.maxOutputTokens < 8192);
});

test('invalid allowances and failed runtime discovery remain explicit failures', async () => {
  await assert.rejects(resolveProviderGenerationBudget(deepseek, {
    ...requested, maxContentTokens: 0,
  }), /正文预算/);
  await assert.rejects(resolveProviderGenerationBudget({
    baseUrl: 'http://local.test/v1', model: 'local', providerType: 'llama-cpp',
  }, requested, async () => new Response('unavailable', { status: 503 })), /HTTP 503/);
});
