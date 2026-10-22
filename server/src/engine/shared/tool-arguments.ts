/** Tool calls keep their JSON values until an executor's compatibility boundary. */
export type ToolArguments = Record<string, unknown>;

/** Existing local and virtual executors consume text fields, including encoded JSON. */
export function legacyToolArguments(args: ToolArguments): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(args)) {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    if (text !== undefined) result[name] = text;
  }
  return result;
}
