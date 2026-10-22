import { isProviderType, isTransportId } from '../contracts/provider-config.js';
import { ProviderConfigurationError, isRecord } from './provider-config-error.js';

export const PROVIDER_FIELDS = new Set(['label', 'baseUrl', 'apiKey', 'models', 'customHeaders', 'providerType',
  'transport', 'protocol', 'runtimePolicy', 'generationDefaults', 'customRequestParameters',
  'customParameterDefinitions', 'modelProfiles', 'nativeMode', 'nativeProbe', 'modelCapabilities', 'toolTransports']);
const maps = ['runtimePolicy', 'generationDefaults', 'customRequestParameters', 'nativeProbe',
  'modelCapabilities', 'toolTransports'];

export function validateProviderPatch(input: unknown, create = false, stored = false): Record<string, unknown> {
  if (!isRecord(input) || (!stored && Object.keys(input).some(key => !PROVIDER_FIELDS.has(key)))) throw invalid();
  const original = input;
  const value = { ...input };
  for (const [key, item] of Object.entries(value)) {
    if (item !== null) continue;
    if (!PROVIDER_FIELDS.has(key)) { if (stored) continue; throw invalid(); }
    if (['label', 'baseUrl', 'apiKey', 'models'].includes(key)) throw invalid();
    delete value[key];
  }
  for (const field of ['label', 'baseUrl', 'apiKey']) {
    if (value[field] !== undefined && typeof value[field] !== 'string') throw invalid();
  }
  // A newly added compatible provider is a draft until its address is filled in.
  if (create && typeof value.baseUrl !== 'string') throw invalid();
  if (typeof value.baseUrl === 'string' && value.baseUrl.trim()) {
    try {
      const url = new URL(value.baseUrl as string);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) throw invalid();
    } catch { throw invalid(); }
  }
  if (value.apiKey !== undefined && /[\r\n]/.test(value.apiKey as string)) throw invalid();
  if (value.models !== undefined && (!Array.isArray(value.models)
    || !value.models.every(item => typeof item === 'string' && !!item.trim()))) throw invalid();
  if (value.customHeaders !== undefined) {
    if (!isRecord(value.customHeaders)) throw invalid();
    for (const [name, header] of Object.entries(value.customHeaders)) {
      if (typeof header !== 'string') throw invalid();
      try { new Headers({ [name]: header }); } catch { throw invalid(); }
    }
  }
  if (value.providerType !== undefined && !isProviderType(value.providerType)) throw invalid();
  if (value.transport !== undefined && !isTransportId(value.transport)) throw invalid();
  if (value.protocol !== undefined && !['auto', 'openai-chat-completions', 'anthropic-messages'].includes(value.protocol as string)) throw invalid();
  if (value.nativeMode !== undefined && !['auto', 'native', 'text'].includes(value.nativeMode as string)) throw invalid();
  for (const field of maps) if (value[field] !== undefined && !isRecord(value[field])) throw invalid();
  if (value.modelProfiles !== undefined && (!isRecord(value.modelProfiles)
    || !Object.values(value.modelProfiles).every(profile => typeof profile === 'string'))) throw invalid();
  if (value.customParameterDefinitions !== undefined && !Array.isArray(value.customParameterDefinitions)) throw invalid();
  return structuredClone(original);
}

function invalid() {
  return new ProviderConfigurationError(400, 'PROVIDER_CONFIGURATION_INPUT_INVALID', '模型提供商配置无效，请检查地址、认证信息和参数格式');
}
