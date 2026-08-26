import type {
  LocalizedText, ProviderConfigurationField, ProviderConfigurationNumericField,
  ProviderConfigurationSchema, ProviderConfigurationSelectField,
} from '../contracts/provider-configuration.js';
import { DEFAULT_ZHIPU_CONFIG, ZHIPU_CONFIG_LIMITS } from './zhipu-config.js';

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
    text('限制思考与正文的总输出预算。', 'Limits the combined reasoning and answer budget.'),
    'integer', false, ZHIPU_CONFIG_LIMITS.maxOutputTokens),
  numberField('generationDefaults.temperature', text('温度', 'Temperature'),
    text('留空继承模型默认；通常不要与 Top P 同时调整。', 'Leave empty for the model default; normally do not tune it together with Top P.'),
    'number', true, ZHIPU_CONFIG_LIMITS.temperature, 0.01),
  numberField('generationDefaults.topP', text('Top P', 'Top P'),
    text('留空继承模型默认；通常不要与温度同时调整。', 'Leave empty for the model default; normally do not tune it together with temperature.'),
    'number', true, ZHIPU_CONFIG_LIMITS.topP, 0.01),
  selectField('generationDefaults.thinkingMode', text('思考模式', 'Thinking mode'),
    text('自动使用保留式动态思考；也可按轮开启或关闭。', 'Auto uses preserved dynamic thinking; it can also be enabled or disabled per turn.'), [
      ['auto', text('自动', 'Auto')], ['enabled', text('开启', 'Enabled')], ['disabled', text('关闭', 'Disabled')],
    ]),
  selectField('generationDefaults.reasoningEffort', text('思考等级', 'Reasoning effort'),
    text('仅适用于 GLM-5.2 与 GLM-5.3；其他模型选择具体等级会被拒绝。', 'Only applies to GLM-5.2 and GLM-5.3; explicit levels are rejected for other models.'), [
      ['auto', text('自动', 'Auto')], ['low', text('低', 'Low')],
      ['high', text('高', 'High')], ['max', text('最大', 'Max')],
    ]),
];

export const ZHIPU_CONFIGURATION_SCHEMA: ProviderConfigurationSchema = {
  defaults: { generationDefaults: { ...DEFAULT_ZHIPU_CONFIG.generationDefaults } },
  sections: [{ id: 'generationDefaults', label: text('生成默认值', 'Generation defaults'), fields }],
};
