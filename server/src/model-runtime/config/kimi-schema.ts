import type {
  LocalizedText,
  ProviderConfigurationField,
  ProviderConfigurationNumericField,
  ProviderConfigurationSchema,
  ProviderConfigurationSelectField,
} from '../contracts/provider-configuration.js';
import { DEFAULT_KIMI_CONFIG, KIMI_CONFIG_LIMITS } from './kimi-config.js';

const text = (zh: string, en: string): LocalizedText => ({ zh, en });

function numberField(): ProviderConfigurationNumericField {
  return {
    path: 'generationDefaults.maxOutputTokens',
    label: text('最大输出 Tokens', 'Maximum output tokens'),
    description: text(
      '限制思考与正文的总输出预算；框架发送 max_completion_tokens。',
      'Limits the combined reasoning and answer budget; sent as max_completion_tokens.',
    ),
    kind: 'integer', nullable: false, ...KIMI_CONFIG_LIMITS.maxOutputTokens,
  };
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
  numberField(),
  selectField(
    'generationDefaults.thinkingMode', text('思考模式', 'Thinking mode'),
    text(
      '自动遵循模型规则；K3 与 K2.7 Code 不能关闭，K2.6 可开启或关闭。',
      'Auto follows model rules; K3 and K2.7 Code cannot be disabled, while K2.6 can.',
    ),
    [
      ['auto', text('自动', 'Auto')],
      ['enabled', text('开启', 'Enabled')],
      ['disabled', text('关闭', 'Disabled')],
    ],
  ),
  selectField(
    'generationDefaults.reasoningEffort', text('思考等级', 'Reasoning effort'),
    text(
      '仅适用于 Kimi K3；其他模型选择具体等级会被拒绝。',
      'Only applies to Kimi K3; explicit levels are rejected for other models.',
    ),
    [
      ['auto', text('自动', 'Auto')],
      ['low', text('低', 'Low')],
      ['high', text('高', 'High')],
      ['max', text('最大', 'Max')],
    ],
  ),
];

export const KIMI_CONFIGURATION_SCHEMA: ProviderConfigurationSchema = {
  defaults: { generationDefaults: { ...DEFAULT_KIMI_CONFIG.generationDefaults } },
  sections: [{
    id: 'generationDefaults',
    label: text('生成默认值', 'Generation defaults'),
    fields: generationFields,
  }],
};
