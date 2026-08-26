import type {
  LocalizedText, ProviderConfigurationField, ProviderConfigurationNumericField,
  ProviderConfigurationSchema, ProviderConfigurationSelectField,
} from '../contracts/provider-configuration.js';
import { DASHSCOPE_CONFIG_LIMITS, DEFAULT_DASHSCOPE_CONFIG } from './dashscope-config.js';

const text = (zh: string, en: string): LocalizedText => ({ zh, en });

function numberField(
  path: string, label: LocalizedText, description: LocalizedText,
  kind: 'integer' | 'number', nullable: boolean,
  range: { min: number; max: number }, step?: number,
): ProviderConfigurationNumericField {
  return { path, label, description, kind, nullable, ...range, ...(step ? { step } : {}) };
}

function selectField(
  path: string, label: LocalizedText, description: LocalizedText,
  values: Array<[string, LocalizedText]>,
): ProviderConfigurationSelectField {
  return { path, label, description, kind: 'select', nullable: false,
    options: values.map(([value, optionLabel]) => ({ value, label: optionLabel })) };
}

const fields: ProviderConfigurationField[] = [
  numberField('generationDefaults.maxOutputTokens', text('最大输出 Tokens', 'Maximum output tokens'),
    text('实际可用上限由所选模型决定。', 'The selected model determines the effective limit.'),
    'integer', false, DASHSCOPE_CONFIG_LIMITS.maxOutputTokens),
  numberField('generationDefaults.temperature', text('温度', 'Temperature'),
    text('留空继承模型默认；通常不要与 Top P 同时调整。', 'Leave empty for the model default; normally do not tune it together with Top P.'),
    'number', true, DASHSCOPE_CONFIG_LIMITS.temperature, 0.01),
  numberField('generationDefaults.topP', text('Top P', 'Top P'),
    text('留空继承模型默认；通常不要与温度同时调整。', 'Leave empty for the model default; normally do not tune it together with temperature.'),
    'number', true, DASHSCOPE_CONFIG_LIMITS.topP, 0.01),
  selectField('generationDefaults.thinkingMode', text('思考模式', 'Thinking mode'),
    text('自动继承模型默认；显式开关仅用于支持混合思考的 Qwen 模型。', 'Auto inherits the model default; explicit control is for Qwen models with hybrid thinking.'), [
      ['auto', text('自动', 'Auto')], ['enabled', text('开启', 'Enabled')], ['disabled', text('关闭', 'Disabled')],
    ]),
  numberField('generationDefaults.thinkingBudgetTokens', text('思考预算 Tokens', 'Thinking budget tokens'),
    text('留空继承模型默认；仅向支持该参数的 Qwen 思考模型发送。', 'Leave empty for the model default; sent only to supported Qwen reasoning models.'),
    'integer', true, DASHSCOPE_CONFIG_LIMITS.thinkingBudgetTokens),
];

export const DASHSCOPE_CONFIGURATION_SCHEMA: ProviderConfigurationSchema = {
  defaults: { generationDefaults: { ...DEFAULT_DASHSCOPE_CONFIG.generationDefaults } },
  sections: [{ id: 'generationDefaults', label: text('生成默认值', 'Generation defaults'), fields }],
};
