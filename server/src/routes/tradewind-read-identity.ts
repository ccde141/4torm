/** Query values still pass the feature parser; this adapter does not grant execution access. */
export function tradewindReadIdentity(query: unknown): Record<string, unknown> {
  if (!query || typeof query !== 'object' || Array.isArray(query)) return {};
  const value = query as Record<string, unknown>;
  return { ...(value.executionId === undefined ? {} : { executionId: value.executionId }),
    ...(value.workflowId === undefined ? {} : { workflowId: value.workflowId }) };
}
