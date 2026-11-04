/** Empty value is the unclassified group; its visible name is localized. */
export function skillCategory(value: unknown): string {
  return typeof value === 'string' && value.trim().length <= 60 ? value.trim() : '';
}
