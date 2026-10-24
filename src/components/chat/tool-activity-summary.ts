export function toolActivitySummary(tool: string, args: Record<string, unknown> = {}): string {
  const input = record(args.input) ? args.input : parseInput(args.input);
  const target = [args.target, args.memberId, args.name, input?.target, input?.seatId,
    input?.workshopId, input?.workflowId, args.filePath, args.path, args.command, args.query, args.url]
    .find(value => typeof value === 'string' && value.trim());
  const action = tool.startsWith('framework_capability_') && typeof args.action === 'string' ? args.action : '';
  return [action, typeof target === 'string' ? target.trim() : ''].filter(Boolean).join(' · ');
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function parseInput(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'string') return undefined;
  try { const parsed: unknown = JSON.parse(value); return record(parsed) ? parsed : undefined; }
  catch { return undefined; }
}
