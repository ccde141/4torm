import type {
  LocalizedText,
  ProviderConfigurationField,
  ProviderConfigurationNumericField,
  ProviderConfigurationSchema,
  ProviderConfigurationSelectField,
} from '../contracts/provider-configuration.js';
import { DEFAULT_OLLAMA_CONFIG, OLLAMA_CONFIG_LIMITS } from './ollama-config.js';

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

const generationFields: ProviderConfigurationField[] = [
  field(
    'generationDefaults.maxOutputTokens',
    text('最大输出 Tokens', 'Maximum output tokens'),
    text('同时限制思考与正文；思考较长时应相应提高。', 'Limits reasoning and final text together; raise it for longer thinking.'),
    'integer', false, OLLAMA_CONFIG_LIMITS.maxOutputTokens,
  ),
  field(
    'generationDefaults.temperature',
    text('温度', 'Temperature'),
    text('留空时沿用 Ollama 或模型默认值。', 'Leave empty to inherit the Ollama or model default.'),
    'number', true, OLLAMA_CONFIG_LIMITS.temperature, 0.01,
  ),
  field(
    'generationDefaults.topP',
    text('Top P', 'Top P'),
    text('留空时沿用 Ollama 或模型默认值。', 'Leave empty to inherit the Ollama or model default.'),
    'number', true, OLLAMA_CONFIG_LIMITS.topP, 0.01,
  ),
  selectField(
    'generationDefaults.reasoningEffort',
    text('思考等级', 'Reasoning effort'),
    text('自动沿用模型默认；具体等级是否有效由当前模型决定。', 'Auto inherits the model default; supported levels depend on the model.'),
    [
      { value: 'auto', label: text('自动', 'Auto') },
      { value: 'none', label: text('关闭', 'None') },
      { value: 'low', label: text('低', 'Low') },
      { value: 'medium', label: text('中', 'Medium') },
      { value: 'high', label: text('高', 'High') },
    ],
  ),
];

export const OLLAMA_CONFIGURATION_SCHEMA: ProviderConfigurationSchema = {
  defaults: {
    generationDefaults: { ...DEFAULT_OLLAMA_CONFIG.generationDefaults },
  },
  sections: [{
    id: 'generationDefaults',
    label: text('生成默认值', 'Generation defaults'),
    fields: generationFields,
  }],
};
