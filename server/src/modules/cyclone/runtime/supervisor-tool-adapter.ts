import { randomUUID } from 'node:crypto';
import { AgentToolOutput, COLLABORATION_PERMISSIONS, type FeatureModule } from '../../../engine/collaboration/contracts.js';
import type { CollaborationRouter } from '../../../engine/collaboration/router.js';
import { frameworkError } from '../../../engine/shared/framework-error.js';
import type { ToolDef } from '../../../engine/shared/tool-defs-loader.js';
import type { ToolCallOutcome } from '../../../engine/shared/react/native-loop.js';
import { loadSupervisor } from '../../../engine/cyclone/supervisor-store.js';
import type { SupervisorToolPort } from '../../../engine/cyclone/supervisor-tools.js';
import { createSupervisorDispatchRecord } from '../../../engine/cyclone/seat-dispatch.js';
import { kickDispatchQueue } from '../../../engine/cyclone/dispatch-queue.js';
import { loadWorkshop } from '../../../engine/cyclone/workshop-store.js';
import { loadSeat } from '../../../engine/cyclone/seat-store.js';
import { createSeatContactEndpoint, execContactOutcome, type ContactCtx } from '../../../engine/cyclone/contact.js';
import { readContactCommunicationOutcome } from '../../../engine/cyclone/contact-communication.js';
import { supervisorCommunicationTools, supervisorManagementTools, type SupervisorMethodTool } from './supervisor-tool-schemas.js';

const MAX_RESULT_CHARS = 24_000;

function scopedMethods(module: FeatureModule): SupervisorMethodTool[] {
  const derived = module.manifest.methods.flatMap(method => {
    if (!method.agentTool) return [];
    if (['configureCollaborationSupervisor', 'startCollaborationSupervisorChat'].includes(method.id)) return [];
    const parameters = structuredClone(method.inputSchema) as NonNullable<ToolDef['parameters']>;
    const local = Object.hasOwn(parameters.properties ?? {}, 'workshopId');
    if (!local && method.agentTool.name !== 'list_collaboration_agents') return [];
    if (parameters.properties) delete parameters.properties.workshopId;
    parameters.required = parameters.required?.filter(name => name !== 'workshopId');
    return [{ method: method.id, definition: { ...method.agentTool, parameters } }];
  });
  const available = new Set(module.manifest.methods.filter(method => method.audiences.includes('internal'))
    .map(method => method.id));
  return [...derived, ...supervisorManagementTools().filter(tool => available.has(tool.method))];
}

/** The local port changes only identity binding; business state remains owned by the module. */
export function createSupervisorToolAdapter(dataDir: string, module: FeatureModule,
  report: SupervisorToolPort['report']): { port: SupervisorToolPort; connect(router: CollaborationRouter): void } {
  if (module.manifest.id !== 'cyclone') throw new Error('主管工具只能绑定气旋模块');
  const bindings = new Map(scopedMethods(module).map(binding => [binding.definition.name, binding]));
  const communication = supervisorCommunicationTools();
  const definitions = [...bindings.values()].map(binding => binding.definition).concat(communication);
  let router: CollaborationRouter | undefined;
  const port: SupervisorToolPort = { definitions, report,
    async call(workshopId, name, args, signal) {
      try {
        signal?.throwIfAborted();
        const definition = definitions.find(tool => tool.name === name);
        if (!definition) throw invalid('主管无法调用此工具');
        const input = decodeArguments(definition, args);
        const supervisor = await loadSupervisor(dataDir, workshopId);
        if (!supervisor.agentId) throw invalid('请先为工作室主管绑定 Agent');
        if (name === 'contact_read') return readContactCommunicationOutcome({ dataDir, workshopId,
          fromSeatId: 'supervisor', sourceKind: 'supervisor' }, input as Record<string, string>);
        if (name === 'contact') return await contact(dataDir, workshopId, input, signal);
        if (name === 'dispatch') {
          const item = await createSupervisorDispatchRecord(dataDir, { workshopId,
            targetSeatTitle: requiredText(input.target), task: requiredText(input.task),
            sourceTurnId: `supervisor-turn-${randomUUID()}` });
          kickDispatchQueue(dataDir, workshopId, item.targetSeatId);
          return { ok: true, result: JSON.stringify({ dispatchId: item.id, status: item.status,
            delivered: false, targetSeatId: item.targetSeatId, targetSeatTitle: item.targetSeatTitle,
            admissionDeadlineAt: item.admissionDeadlineAt,
            message: '任务已登记；接入与完成由后续派发回执报告，请继续当前工作。' }) };
        }
        const binding = bindings.get(name)!;
        if (!router) throw new Error('主管工具尚未连接中心路由');
        const value = await router.invoke({ feature: 'cyclone', method: binding.method,
          input: { ...input, ...binding.fixed,
            ...(name === 'list_collaboration_agents' ? {} : { workshopId }) } }, {
          actor: { type: 'agent', id: supervisor.agentId, actingAs: 'human' }, audience: 'internal',
          enabledFeatures: new Set(['cyclone']), permissions: new Set(COLLABORATION_PERMISSIONS),
          requestId: `supervisor:${workshopId}:${randomUUID()}`, signal,
        });
        return readableResult(value, binding, module);
      } catch (error) { return { ok: false, result: error instanceof Error ? error.message : String(error) }; }
    },
  };
  return { port, connect(value) {
    if (router && router !== value) throw new Error('主管工具已连接另一个中心路由');
    router = value;
  } };
}

function decodeArguments(definition: ToolDef, args: Record<string, string>): Record<string, unknown> {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw invalid('工具参数必须为对象');
  const properties = definition.parameters?.properties ?? {};
  const result: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(args)) {
    if (name === 'workshopId' || !Object.hasOwn(properties, name)) {
      throw invalid(`不支持参数 ${name}；所属工作室由框架绑定`);
    }
    const type = properties[name]?.type;
    result[name] = type && type !== 'string' && typeof value === 'string' ? JSON.parse(value) : value;
  }
  for (const name of definition.parameters?.required ?? []) {
    if (!Object.hasOwn(result, name)) throw invalid(`缺少参数 ${name}`);
  }
  return result;
}

async function contact(dataDir: string, workshopId: string, input: Record<string, unknown>,
  signal?: AbortSignal): Promise<ToolCallOutcome> {
  const target = requiredText(input.target);
  const message = requiredText(input.message);
  const context: ContactCtx = { dataDir, workshopId, fromSeatId: 'supervisor',
    fromTitle: '工作室主管', sourceKind: 'supervisor', depth: 0, signal };
  context.resolveEndpoint = async (title, content) => {
    const workshop = await loadWorkshop(dataDir, workshopId);
    const seats = await Promise.all((workshop?.seatIds ?? []).map(id => loadSeat(dataDir, workshopId, id)));
    const identified = seats.find(item => item?.id === title);
    const matches = seats.filter(item => item?.title === title);
    if (!identified && matches.length > 1) throw invalid('目标工位名称存在歧义，请使用工位 ID');
    const seat = identified ?? matches[0];
    if (!seat) throw frameworkError({ code: 'CYCLONE_SEAT_NOT_FOUND', kind: 'not_found',
      message: '目标工位不存在或不属于当前工作室', source: 'cyclone.supervisor', retryable: false });
    return createSeatContactEndpoint(context, seat, content);
  };
  return execContactOutcome(context, target, message);
}

function readableResult(output: unknown, binding: SupervisorMethodTool, module: FeatureModule): ToolCallOutcome {
  const value = output instanceof AgentToolOutput ? output.value : output;
  const result = JSON.stringify(value ?? { ok: true });
  if (result.length <= MAX_RESULT_CHARS) return { ok: true, result,
    ...(output instanceof AgentToolOutput && output.meta ? { meta: output.meta } : {}) };
  const command = module.manifest.methods.find(method => method.id === binding.method)?.kind === 'command';
  return { ok: command, result: JSON.stringify({ applied: command, method: binding.method,
    totalChars: result.length, resultOmitted: true,
    message: command ? '操作已完成，完整结果仍保存在工作室；请用分页读取工具核对，不要重复执行。'
      : '内容超过单次返回范围，请改用分页读取工具定位需要的工位、消息或派发。',
    readWith: ['read_collaboration_console', 'read_collaboration_seat_history',
      'read_collaboration_thread', 'read_collaboration_message', 'read_collaboration_dispatch'],
  }) };
}

function requiredText(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 20_000) throw invalid('目标与工作内容必须为有效文本');
  return value.trim();
}

function invalid(message: string) {
  return frameworkError({ code: 'CYCLONE_SUPERVISOR_TOOL_INPUT_INVALID', kind: 'validation',
    message, source: 'cyclone.supervisor', retryable: false });
}
