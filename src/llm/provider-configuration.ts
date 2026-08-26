import type {
  ProviderConfigurationField,
  ProviderConfigurationNumericField,
  ProviderConfigurationSchema,
  ProviderConfigurationValue,
} from './provider-catalog';

export type ConfigurationLocale = 'zh' | 'en';
type ConfigurationRecord = Record<string, unknown>;

export function configurationValue(
  provider: unknown,
  defaults: ProviderConfigurationSchema['defaults'],
  path: string,
): ProviderConfigurationValue | undefined {
  const [section, field] = splitPath(path);
  const persisted = nestedValue(isRecord(provider) ? provider : {}, section, field);
  return persisted !== undefined ? persisted : defaults[section]?.[field];
}

export function parseConfigurationInput(
  raw: string,
  field: ProviderConfigurationField,
  locale: ConfigurationLocale,
): { value: ProviderConfigurationValue } | { error: string } {
  const input = raw.trim();
  if (!input) {
    if (field.nullable) return { value: null };
    return { error: locale === 'zh' ? `${field.label.zh} 不能为空。` : `${field.label.en} cannot be empty.` };
  }
  if (field.kind === 'select') {
    if (field.options.some(option => option.value === input)) return { value: input };
    return { error: locale === 'zh'
      ? `${field.label.zh} 不是有效选项。`
      : `${field.label.en} has an invalid option.` };
  }
  const value = Number(input);
  if (!Number.isFinite(value)) return { error: numericError(field, locale) };
  if (field.kind === 'integer' && !Number.isInteger(value)) return { error: integerError(field, locale) };
  if (value < field.min || value > field.max) return { error: rangeError(field, locale) };
  return { value };
}

export function configurationPatch(
  provider: unknown,
  path: string,
  value: ProviderConfigurationValue,
): Record<string, Record<string, ProviderConfigurationValue>> {
  const [section, field] = splitPath(path);
  const current = isRecord(provider) ? provider[section] : undefined;
  const values = isRecord(current) ? current : {};
  return { [section]: { ...values, [field]: value } as Record<string, ProviderConfigurationValue> };
}

export function validateConfigurationConstraints(
  provider: unknown,
  schema: ProviderConfigurationSchema,
  locale: ConfigurationLocale,
): string | undefined {
  for (const constraint of schema.constraints ?? []) {
    const value = configurationValue(provider, schema.defaults, constraint.valuePath);
    const limit = configurationValue(provider, schema.defaults, constraint.limitPath);
    if (constraint.kind === 'less-than' && typeof value === 'number'
      && typeof limit === 'number' && value >= limit) return constraint.message[locale];
  }
  return undefined;
}

function splitPath(path: string): [string, string] {
  const parts = path.split('.');
  if (parts.length !== 2 || parts.some(part => !part)) throw new Error(`Invalid provider configuration path: ${path}`);
  return [parts[0], parts[1]];
}

function nestedValue(record: ConfigurationRecord, section: string, field: string) {
  const values = record[section];
  if (!isRecord(values)) return undefined;
  const value = values[field];
  return value === null || typeof value === 'number' || typeof value === 'string' ? value : undefined;
}

function numericError(field: ProviderConfigurationField, locale: ConfigurationLocale): string {
  return locale === 'zh' ? `${field.label.zh} 必须是数字。` : `${field.label.en} must be a number.`;
}

function integerError(field: ProviderConfigurationField, locale: ConfigurationLocale): string {
  return locale === 'zh' ? `${field.label.zh} 必须是整数。` : `${field.label.en} must be an integer.`;
}

function rangeError(field: ProviderConfigurationNumericField, locale: ConfigurationLocale): string {
  return locale === 'zh'
    ? `${field.label.zh} 必须在 ${field.min} 到 ${field.max} 之间。`
    : `${field.label.en} must be between ${field.min} and ${field.max}.`;
}

function isRecord(value: unknown): value is ConfigurationRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
