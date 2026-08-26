import type {
  LocalizedText,
  ProviderConfigurationField,
  ProviderConfigurationNumericField,
  ProviderConfigurationSchema,
  ProviderConfigurationSelectField,
} from '../contracts/provider-configuration.js';
import { DEFAULT_VLLM_CONFIG, VLLM_CONFIG_LIMITS } from './vllm-config.js';

const text = (zh: string, en: string): LocalizedText => ({ zh, en });

function numberField(
  path: string,
  label: string,
  description: LocalizedText,
  kind: ProviderConfigurationNumericField['kind'],
  nullable: boolean,
  range: { min: number; max: number },
  step?: number,
): ProviderConfigurationNumericField {
  return {
    path, label: text(label, label), description, kind, nullable, ...range,
    ...(step ? { step } : {}),
  };
}

function selectField(): ProviderConfigurationSelectField {
  const values = ['auto', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
  return {
    path: 'generationDefaults.reasoningEffort',
    label: text('思考等级', 'Reasoning effort'),
    description: text(
      '自动沿用模型模板；其他值由 vLLM 接受，但实际语义取决于模型与 reasoning parser。',
      'Auto inherits the model template; other values are accepted by vLLM but depend on the model and reasoning parser.',
    ),
    kind: 'select', nullable: false,
    options: values.map(value => ({ value, label: text(value, value) })),
  };
}

const fields: ProviderConfigurationField[] = [
  numberField(
    'generationDefaults.maxOutputTokens', 'Maximum output tokens',
    text('限制思考与正文的总输出预算。', 'Limits reasoning and final text together.'),
    'integer', false, VLLM_CONFIG_LIMITS.maxOutputTokens,
  ),
  numberField(
    'generationDefaults.temperature', 'Temperature',
    text('留空沿用模型或服务端默认。', 'Leave empty to inherit the model or server default.'),
    'number', true, VLLM_CONFIG_LIMITS.temperature, 0.01,
  ),
  numberField(
    'generationDefaults.topP', 'Top P',
    text('留空沿用服务端默认。', 'Leave empty to inherit the server default.'),
    'number', true, VLLM_CONFIG_LIMITS.topP, 0.01,
  ),
  numberField(
    'generationDefaults.topK', 'Top K',
    text('-1 表示禁用；留空沿用服务端默认。', '-1 disables it; leave empty to inherit the server default.'),
    'integer', true, VLLM_CONFIG_LIMITS.topK,
  ),
  numberField(
    'generationDefaults.minP', 'Min P',
    text('vLLM 扩展采样字段；留空不发送。', 'A vLLM sampling extension; leave empty to omit it.'),
    'number', true, VLLM_CONFIG_LIMITS.minP, 0.01,
  ),
  numberField(
    'generationDefaults.repetitionPenalty', 'Repetition penalty',
    text('1 表示无惩罚；留空沿用模型默认。', '1 means no penalty; leave empty for the model default.'),
    'number', true, VLLM_CONFIG_LIMITS.repetitionPenalty, 0.01,
  ),
  selectField(),
];

export const VLLM_CONFIGURATION_SCHEMA: ProviderConfigurationSchema = {
  defaults: { generationDefaults: { ...DEFAULT_VLLM_CONFIG.generationDefaults } },
  sections: [{
    id: 'generationDefaults',
    label: text('生成默认值', 'Generation defaults'),
    fields,
  }],
};
