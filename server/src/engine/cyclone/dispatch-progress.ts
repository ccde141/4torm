import type { SeatEvent } from './seat-runner.js';
import type { DispatchActivity } from './dispatch-store.js';

function activityTarget(args: Record<string, string>): string | undefined {
  for (const key of ['path', 'filePath', 'file', 'command', 'cmd', 'url', 'query']) {
    const value = args[key]?.trim();
    if (value) return value.slice(0, 240);
  }
  return undefined;
}

export function reduceDispatchActivity(
  current: DispatchActivity | undefined,
  event: SeatEvent,
): DispatchActivity | undefined {
  if (event.type === 'queue-wait') return { phase: 'waiting-agent' };
  if (event.type === 'token' || event.type === 'reasoning') return { phase: 'model-output' };
  if (event.type === 'tool-progress') {
    return {
      phase: 'tool-preparing', tool: event.tool,
      elapsedSeconds: Math.round(event.elapsed / 1000), argumentChars: event.argumentChars,
    };
  }
  if (event.type === 'tool-call') {
    const target = activityTarget(event.args);
    return { phase: 'tool-exec', tool: event.tool, ...(target ? { target } : {}) };
  }
  if (event.type === 'tool-result' || event.type === 'delegate-done' || event.type === 'contact-done') {
    return { phase: 'llm-waiting' };
  }
  if (event.type === 'delegate-start') {
    return { phase: 'tool-exec', tool: 'delegate', target: event.task.slice(0, 240) };
  }
  if (event.type === 'contact-start') {
    return { phase: 'tool-exec', tool: 'contact', target: event.target.slice(0, 240) };
  }
  if (event.type === 'heartbeat') {
    return {
      phase: event.phase,
      ...(current?.tool ? { tool: current.tool } : {}),
      ...(current?.target ? { target: current.target } : {}),
      elapsedSeconds: Math.round(event.elapsed / 1000),
    };
  }
  return current;
}
