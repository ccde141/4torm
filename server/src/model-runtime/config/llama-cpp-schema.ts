import type {
  LocalizedText,
  ProviderConfigurationField,
  ProviderConfigurationNumericField,
  ProviderConfigurationSchema,
  ProviderConfigurationSelectField,
} from '../contracts/provider-configuration.js';
import {
  DEFAULT_LLAMA_CPP_CONFIG,
  LLAMA_CPP_CONFIG_LIMITS,
} from './llama-cpp-config.js';

const text = (zh: string, en: string): LocalizedText => ({ zh, en });

function field(
  path: string,
  label: LocalizedText,
  description: LocalizedText,
  kind: ProviderConfigurationNumericField['kind'],
  nullable: boolean,
  range: { min: number; max: number },
  step?: number,
): ProviderConfigurationNumericField {
  return { path, label, description, kind, nullable, ...range, ...(step ? { step } : {}) };
}

function selectField(
  path: string,
  label: LocalizedText,
  description: LocalizedText,
  options: ProviderConfigurationSelectField['options'],
): ProviderConfigurationSelectField {
  return { path, label, description, kind: 'select', nullable: false, options };
}

const runtimeFields: ProviderConfigurationField[] = [
  field(
    'runtimePolicy.contextWindowTokens',
    text('上下文容量上限', 'Context window cap'),
    text('留空时读取 llama.cpp /props 的实际单槽 n_ctx；填写后只会进一步收紧。', 'Leave empty to use the actual per-slot n_ctx from llama.cpp /props; a value only tightens it.'),
    'integer', true, LLAMA_CPP_CONFIG_LIMITS.contextWindowTokens,
  ),
  field(
    'runtimePolicy.maxConcurrency',
    text('最大并发', 'Maximum concurrency'),
    text('留空时使用 /props 的 total_slots；填写后限制本 Provider 实例的并发。', 'Leave empty to use total_slots from /props; a value caps this provider instance.'),
    'integer', true, LLAMA_CPP_CONFIG_LIMITS.maxConcurrency,
  ),
];

const generationFields: ProviderConfigurationField[] = [
  field(
    'generationDefaults.maxOutputTokens',
    text('最大输出 Tokens', 'Maximum output tokens'),
    text('框架为每次生成预留的默认输出上限；具体功能区可进一步覆盖。', 'Default output reservation for each generation; a feature may override it.'),
    'integer', false, LLAMA_CPP_CONFIG_LIMITS.maxOutputTokens,
  ),
  field(
    'generationDefaults.temperature',
    text('温度', 'Temperature'),
    text('留空时沿用 llama.cpp 服务端默认值。', 'Leave empty to inherit the llama.cpp server default.'),
    'number', true, LLAMA_CPP_CONFIG_LIMITS.temperature, 0.01,
  ),
  field(
    'generationDefaults.topK',
    text('Top K', 'Top K'),
    text('留空时沿用服务端默认值；0 表示禁用 Top K。', 'Leave empty to inherit the server default; 0 disables Top K.'),
    'integer', true, LLAMA_CPP_CONFIG_LIMITS.topK,
  ),
  field(
    'generationDefaults.topP',
    text('Top P', 'Top P'),
    text('留空时沿用服务端默认值；1 表示禁用 Top P。', 'Leave empty to inherit the server default; 1 disables Top P.'),
    'number', true, LLAMA_CPP_CONFIG_LIMITS.topP, 0.01,
  ),
  field(
    'generationDefaults.minP',
    text('Min P', 'Min P'),
    text('留空时沿用服务端默认值；0 表示禁用 Min P。', 'Leave empty to inherit the server default; 0 disables Min P.'),
    'number', true, LLAMA_CPP_CONFIG_LIMITS.minP, 0.01,
  ),
  field(
    'generationDefaults.repeatPenalty',
    text('重复惩罚', 'Repeat penalty'),
    text('留空时沿用服务端默认值；1 表示不施加重复惩罚。', 'Leave empty to inherit the server default; 1 applies no repetition penalty.'),
    'number', true, LLAMA_CPP_CONFIG_LIMITS.repeatPenalty, 0.01,
  ),
  selectField(
    'generationDefaults.thinkingMode',
    text('思考模式', 'Thinking mode'),
    text('自动沿用模型模板；开启或关闭会覆盖本次请求。', 'Auto inherits the model template; enabled or disabled overrides each request.'),
    [
      { value: 'auto', label: text('自动', 'Auto') },
      { value: 'enabled', label: text('开启', 'Enabled') },
      { value: 'disabled', label: text('关闭', 'Disabled') },
    ],
  ),
  field(
    'generationDefaults.thinkingBudgetTokens',
    text('思考 Token 预算', 'Thinking token budget'),
    text('留空时沿用服务端；-1 不限制，0 立即结束，正整数限制思考量。', 'Leave empty to inherit the server; -1 is unlimited, 0 ends immediately, and positive values cap thinking.'),
    'integer', true, LLAMA_CPP_CONFIG_LIMITS.thinkingBudgetTokens,
  ),
];

export const LLAMA_CPP_CONFIGURATION_SCHEMA: ProviderConfigurationSchema = {
  defaults: {
    runtimePolicy: { ...DEFAULT_LLAMA_CPP_CONFIG.runtimePolicy },
    generationDefaults: { ...DEFAULT_LLAMA_CPP_CONFIG.generationDefaults },
  },
  sections: [
    { id: 'runtimePolicy', label: text('运行边界', 'Runtime limits'), fields: runtimeFields },
    { id: 'generationDefaults', label: text('生成默认值', 'Generation defaults'), fields: generationFields },
  ],
  constraints: [{
    kind: 'less-than',
    valuePath: 'generationDefaults.maxOutputTokens',
    limitPath: 'runtimePolicy.contextWindowTokens',
    message: text('最大输出 Tokens 必须小于上下文容量上限。', 'Maximum output tokens must be lower than the context window cap.'),
  }],
};
