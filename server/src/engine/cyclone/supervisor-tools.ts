import path from 'node:path';
import type { ToolDef } from '../shared/tool-defs-loader.js';
import type { ToolCallOutcome } from '../shared/react/native-loop.js';
import { loadSupervisor } from './supervisor-store.js';

export interface SupervisorToolPort {
  definitions: ToolDef[];
  call(workshopId: string, name: string, args: Record<string, string>, signal?: AbortSignal): Promise<ToolCallOutcome>;
  report(workshopId: string, seatId: string, message: string): Promise<ToolCallOutcome>;
}
const ports = new Map<string, SupervisorToolPort>();
export function registerSupervisorTools(dataDir: string, port: SupervisorToolPort): () => void {
  const key = path.resolve(dataDir);
  ports.set(key, port);
  return () => { if (ports.get(key) === port) ports.delete(key); };
}
export function supervisorTools(dataDir: string): SupervisorToolPort {
  const port = ports.get(path.resolve(dataDir));
  if (!port) throw new Error('工作室主管工具尚未就绪');
  return port;
}
export const SUPERVISOR_REPORT_TOOL: ToolDef = {
  name: 'supervisor_message',
  description: '向当前工作室主管发送进展、结果、阻塞或协调请求。仅发送信息，不向主管派发任务，不替代人类目标。身份与工作室由框架绑定；送达不等于主管已经处理。',
  parameters: { type: 'object', additionalProperties: false, required: ['message'],
    properties: { message: { type: 'string', minLength: 1, maxLength: 12_000 } } },
};
export function reportToSupervisor(dataDir: string, workshopId: string, seatId: string,
  args: Record<string, string>): Promise<ToolCallOutcome> {
  if (Object.keys(args).some(key => key !== 'message') || typeof args.message !== 'string'
    || !args.message.trim() || args.message.length > 12_000) {
    return Promise.resolve({ result: '主管信息参数无效', ok: false });
  }
  return supervisorTools(dataDir).report(workshopId, seatId, args.message.trim());
}
export async function withSupervisorReporting(dataDir: string, workshopId: string, tools: ToolDef[]): Promise<ToolDef[]> {
  if (!(await loadSupervisor(dataDir, workshopId)).agentId || tools.some(tool => tool.name === SUPERVISOR_REPORT_TOOL.name)) return tools;
  return [...tools, SUPERVISOR_REPORT_TOOL];
}
