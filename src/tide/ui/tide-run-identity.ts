export function tideRunIdentity(run: {
  taskId: string; runId?: string; timestamp: string;
}): string {
  return `${run.taskId}:${run.runId ?? run.timestamp}`;
}
