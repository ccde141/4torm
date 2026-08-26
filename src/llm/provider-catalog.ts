export interface LocalizedText {
  zh: string;
  en: string;
}

export interface ProviderConfigurationNumericField {
  path: string;
  label: LocalizedText;
  description: LocalizedText;
  kind: 'integer' | 'number';
  nullable: boolean;
  min: number;
  max: number;
  step?: number;
}

export interface ProviderConfigurationSelectField {
  path: string;
  label: LocalizedText;
  description: LocalizedText;
  kind: 'select';
  nullable: boolean;
  options: Array<{ value: string; label: LocalizedText }>;
}

export type ProviderConfigurationField =
  | ProviderConfigurationNumericField
  | ProviderConfigurationSelectField;

export type ProviderConfigurationValue = number | string | null;

export interface ProviderConfigurationSection {
  id: string;
  label: LocalizedText;
  fields: ProviderConfigurationField[];
}

export interface ProviderConfigurationConstraint {
  kind: 'less-than';
  valuePath: string;
  limitPath: string;
  message: LocalizedText;
}

export interface ProviderConfigurationSchema {
  defaults: Record<string, Record<string, ProviderConfigurationValue>>;
  sections: ProviderConfigurationSection[];
  constraints?: ProviderConfigurationConstraint[];
}

export interface ProviderDescriptor {
  id: string;
  label: string;
  defaultTransport: string;
  supportedTransports: string[];
  probeStrategy: string;
  verificationState: string;
  selectable: boolean;
  configuration?: ProviderConfigurationSchema;
}

export interface ProviderPresetDescriptor {
  id: string;
  label: string;
  baseUrl: string;
  protocol: 'openai-chat-completions' | 'anthropic-messages';
  providerType?: string;
  transport?: string;
}

export interface ProviderCatalog {
  version: number;
  providers: ProviderDescriptor[];
  presets: ProviderPresetDescriptor[];
}

export async function fetchProviderCatalog(): Promise<ProviderCatalog> {
  const response = await fetch('/api/model-runtime/providers');
  if (!response.ok) throw new Error(`Model provider catalog HTTP ${response.status}`);
  const body: unknown = await response.json();
  if (!isProviderCatalog(body)) throw new Error('Invalid model provider catalog');
  return body;
}

export function providerSelectionPatch(catalog: ProviderCatalog, providerType: string) {
  const provider = catalog.providers.find(item => item.id === providerType);
  if (!provider?.selectable) throw new Error(`Model provider is not selectable: ${providerType}`);
  return {
    providerType: provider.id,
    transport: provider.defaultTransport,
    runtimePolicy: undefined,
    generationDefaults: undefined,
    ...(provider.configuration ? structuredClone(provider.configuration.defaults) : {}),
  };
}

function isProviderCatalog(value: unknown): value is ProviderCatalog {
  if (!isRecord(value) || !isFiniteNumber(value.version)) return false;
  return Array.isArray(value.providers) && value.providers.every(isProviderDescriptor)
    && Array.isArray(value.presets) && value.presets.every(isPresetDescriptor);
}

function isProviderDescriptor(value: unknown): value is ProviderDescriptor {
  return isRecord(value) && strings(value, ['id', 'label', 'defaultTransport', 'probeStrategy', 'verificationState'])
    && typeof value.selectable === 'boolean'
    && Array.isArray(value.supportedTransports)
    && value.supportedTransports.every(item => typeof item === 'string')
    && (value.configuration === undefined || isConfigurationSchema(value.configuration));
}

function isConfigurationSchema(value: unknown): value is ProviderConfigurationSchema {
  if (!isRecord(value) || !isConfigurationDefaults(value.defaults) || !Array.isArray(value.sections)) return false;
  if (!value.sections.every(isConfigurationSection)) return false;
  return value.constraints === undefined
    || (Array.isArray(value.constraints) && value.constraints.every(isConfigurationConstraint));
}

function isConfigurationDefaults(value: unknown): value is Record<string, Record<string, ProviderConfigurationValue>> {
  return isRecord(value) && Object.values(value).every(section => isRecord(section)
    && Object.values(section).every(item => item === null || typeof item === 'string' || isFiniteNumber(item)));
}

function isConfigurationSection(value: unknown): value is ProviderConfigurationSection {
  return isRecord(value) && typeof value.id === 'string'
    && isLocalizedText(value.label)
    && Array.isArray(value.fields) && value.fields.every(isConfigurationField);
}

function isConfigurationField(value: unknown): value is ProviderConfigurationField {
  if (!isRecord(value) || typeof value.path !== 'string' || !isLocalizedText(value.label)
    || !isLocalizedText(value.description) || typeof value.nullable !== 'boolean') return false;
  if (value.kind === 'select') return Array.isArray(value.options) && value.options.length > 0
    && value.options.every(option => isRecord(option) && typeof option.value === 'string'
      && option.value.length > 0 && isLocalizedText(option.label))
    && new Set(value.options.map(option => (option as { value: string }).value)).size === value.options.length;
  if ((value.kind !== 'integer' && value.kind !== 'number')
    || !isFiniteNumber(value.min) || !isFiniteNumber(value.max)) return false;
  return value.min <= value.max && (value.step === undefined || (isFiniteNumber(value.step) && value.step > 0));
}

function isConfigurationConstraint(value: unknown): value is ProviderConfigurationConstraint {
  return isRecord(value) && value.kind === 'less-than'
    && strings(value, ['valuePath', 'limitPath']) && isLocalizedText(value.message);
}

function isLocalizedText(value: unknown): value is LocalizedText {
  return isRecord(value) && strings(value, ['zh', 'en']);
}

function isPresetDescriptor(value: unknown): value is ProviderPresetDescriptor {
  if (!isRecord(value) || !strings(value, ['id', 'label', 'baseUrl', 'protocol'])) return false;
  if (value.protocol !== 'openai-chat-completions' && value.protocol !== 'anthropic-messages') return false;
  return optionalString(value.providerType) && optionalString(value.transport);
}

function strings(value: Record<string, unknown>, keys: string[]): boolean {
  return keys.every(key => typeof value[key] === 'string');
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
