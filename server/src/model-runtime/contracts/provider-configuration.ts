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

export interface ProviderConfigurationSchema {
  defaults: Record<string, Record<string, ProviderConfigurationValue>>;
  sections: ProviderConfigurationSection[];
  constraints?: ProviderConfigurationConstraint[];
}

export interface ProviderConfigurationConstraint {
  kind: 'less-than';
  valuePath: string;
  limitPath: string;
  message: LocalizedText;
}
