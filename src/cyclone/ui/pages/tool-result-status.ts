const CANCELLED_TOOL_RESULTS = new Set([
  '（因等待用户回复而取消，未执行）',
  '（已中止，未执行）',
]);

export function isCancelledToolResult(result: string | undefined): boolean {
  return result !== undefined && CANCELLED_TOOL_RESULTS.has(result.trim());
}
