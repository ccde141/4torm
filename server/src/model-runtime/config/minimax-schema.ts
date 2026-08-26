import type {
  LocalizedText, ProviderConfigurationField, ProviderConfigurationNumericField,
  ProviderConfigurationSchema, ProviderConfigurationSelectField,
} from '../contracts/provider-configuration.js';
import { DEFAULT_MINIMAX_CONFIG, MINIMAX_CONFIG_LIMITS } from './minimax-config.js';

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
    text('限制思考与正文的总生成预算。', 'Limits the combined reasoning and answer budget.'),
    'integer', false, MINIMAX_CONFIG_LIMITS.maxOutputTokens),
  numberField('generationDefaults.temperature', text('温度', 'Temperature'),
    text('留空继承模型默认；通常不要与 Top P 同时调整。', 'Leave empty for the model default; normally do not tune it together with Top P.'),
    'number', true, MINIMAX_CONFIG_LIMITS.temperature, 0.01),
  numberField('generationDefaults.topP', text('Top P', 'Top P'),
    text('留空继承模型默认；通常不要与温度同时调整。', 'Leave empty for the model default; normally do not tune it together with temperature.'),
    'number', true, MINIMAX_CONFIG_LIMITS.topP, 0.01),
  selectField('generationDefaults.thinkingMode', text('思考模式', 'Thinking mode'),
    text('仅 MiniMax-M3 可显式开关；M2.x 始终思考。', 'Only MiniMax-M3 supports an explicit switch; M2.x always reasons.'), [
      ['auto', text('自动', 'Auto')], ['enabled', text('开启', 'Enabled')], ['disabled', text('关闭', 'Disabled')],
    ]),
];

export const MINIMAX_CONFIGURATION_SCHEMA: ProviderConfigurationSchema = {
  defaults: { generationDefaults: { ...DEFAULT_MINIMAX_CONFIG.generationDefaults } },
  sections: [{ id: 'generationDefaults', label: text('生成默认值', 'Generation defaults'), fields }],
};
