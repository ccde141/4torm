import type {
  LocalizedText,
  ProviderConfigurationField,
  ProviderConfigurationNumericField,
  ProviderConfigurationSchema,
  ProviderConfigurationSelectField,
} from '../contracts/provider-configuration.js';
import { DEEPSEEK_CONFIG_LIMITS, DEFAULT_DEEPSEEK_CONFIG } from './deepseek-config.js';

const text = (zh: string, en: string): LocalizedText => ({ zh, en });

function numberField(
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
  values: Array<[string, LocalizedText]>,
): ProviderConfigurationSelectField {
  return {
    path, label, description, kind: 'select', nullable: false,
    options: values.map(([value, optionLabel]) => ({ value, label: optionLabel })),
  };
}

const generationFields: ProviderConfigurationField[] = [
  numberField(
    'generationDefaults.maxOutputTokens',
    text('最大输出 Tokens', 'Maximum output tokens'),
    text('限制思考与正文的总输出预算。', 'Limits the combined reasoning and final-answer budget.'),
    'integer', false, DEEPSEEK_CONFIG_LIMITS.maxOutputTokens,
  ),
  numberField(
    'generationDefaults.temperature', text('温度', 'Temperature'),
    text('留空沿用 API 默认；思考开启时 DeepSeek 会忽略此项。', 'Leave empty for the API default; DeepSeek ignores it while thinking is enabled.'),
    'number', true, DEEPSEEK_CONFIG_LIMITS.temperature, 0.1,
  ),
  numberField(
    'generationDefaults.topP', text('Top P', 'Top P'),
    text('留空沿用 API 默认；通常不要与温度同时调整。', 'Leave empty for the API default; normally tune this or temperature, not both.'),
    'number', true, DEEPSEEK_CONFIG_LIMITS.topP, 0.01,
  ),
  selectField(
    'generationDefaults.thinkingMode', text('思考模式', 'Thinking mode'),
    text('自动遵循当前模型默认；也可显式开启或关闭。', 'Auto follows the current model default; it can also be enabled or disabled explicitly.'),
    [
      ['auto', text('自动', 'Auto')],
      ['enabled', text('开启', 'Enabled')],
      ['disabled', text('关闭', 'Disabled')],
    ],
  ),
  selectField(
    'generationDefaults.reasoningEffort', text('思考等级', 'Reasoning effort'),
    text('仅在思考模式有效；实际等级映射取决于具体 DeepSeek 模型。', 'Only applies in thinking mode; exact mappings depend on the DeepSeek model.'),
    [
      ['auto', text('自动', 'Auto')],
      ['low', text('低', 'Low')],
      ['high', text('高', 'High')],
      ['max', text('最大', 'Max')],
    ],
  ),
];

export const DEEPSEEK_CONFIGURATION_SCHEMA: ProviderConfigurationSchema = {
  defaults: { generationDefaults: { ...DEFAULT_DEEPSEEK_CONFIG.generationDefaults } },
  sections: [{
    id: 'generationDefaults',
    label: text('生成默认值', 'Generation defaults'),
    fields: generationFields,
  }],
};
