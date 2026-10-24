import type { ToolDef } from '../../shared/tool-defs-loader.js';
import type { TeamPermissions } from './types.js';
import { TeamRuntime } from './runtime.js';
import { createTeamHandoff } from './handoff.js';
import type { TeamActivityEvent } from './activity.js';

export const TEAM_GUIDANCE = `## 会话工作队 / Session team
有一个可独立交付或复核的责任单元时，可以用 team_start 一步创建成员并派工；task 要包含执行所需的背景、路径和操作边界。
需要先建立持续角色时，仍可 team_create 创建，再用 team_dispatch 派工。派工返回仅表示启动，不表示完成。
成员独立异步工作并保留上下文；用 team_read 检查状态与回执，用 team_wait 等待当前任务。
处理结果后用 team_ack 确认回执；不再需要的空闲成员用 team_dismiss 解散，解散不可复活。
成员不会直接回答人类；当前主轮次在安全节点接收回报，收尾时等待运行中的成员。停止或断线后不自动激活你。协作文件要明确分工，避免并发覆盖。
恢复后的 crashed/aborted/failed 任务需你根据人类后续要求明确重新派工，不会自动重试。`;

export function teamToolDefs(): ToolDef[] {
  const string = { type: 'string' };
  return [
    { name: 'team_start', description: '一步创建本会话成员并立即异步派工。中等任务只要有一块可独立调查、实现或复核的工作即可使用；你可继续主线，随后核验回报。返回运行 ID，不代表完成。',
      parameters: { type: 'object', properties: {
        name: { type: 'string', description: '成员名称，体现本次责任。' },
        task: { type: 'string', description: '自包含任务：目标、必要背景与路径、操作边界、可验收的回报。成员看不到主会话完整历史。' },
        requestId: { type: 'string', description: '本次启动唯一标识：1–160 字，只用 ASCII 字母、数字、下划线或连字符。结果不确定时复用同一标识和参数；新工作使用新标识。' },
        mission: { type: 'string', description: '可选：成员后续持续承担的职责；默认使用成员名称。' },
        rolePrompt: { type: 'string', description: '可选：专业视角与质量标准。' },
        taskContext: { type: 'string', description: '可选：后续派工仍需保留的背景。' },
        constraints: { type: 'string', description: '可选：持续的资源边界和禁止事项，不改变继承权限。' },
      }, required: ['name', 'task', 'requestId'] } },
    { name: 'team_create', description: '创建本会话持续存在的工作队成员。权限继承当前主 Agent；不属于全局 Agent 池。',
      parameters: { type: 'object', properties: {
        name: { type: 'string', description: '成员名称，体现职责，便于识别。' },
        mission: { type: 'string', description: '成员持续负责的使命和责任边界。' },
        rolePrompt: { type: 'string', description: '专业视角、工作方式和质量标准。' },
        taskContext: { type: 'string', description: '完成任务所需的背景、已知事实和明确路径；成员没有主会话完整历史。' },
        constraints: { type: 'string', description: '操作范围、禁止事项、共享资源与协作约束；文字约束不会改变继承权限。' },
      }, required: ['name', 'mission', 'rolePrompt', 'taskContext', 'constraints'] } },
    { name: 'team_dispatch', description: '向空闲成员异步分配任务。立即返回运行 ID；结果需 team_read 或 team_wait 获取。',
      parameters: { type: 'object', properties: { memberId: string, task: string,
        requestId: { type: 'string', description: '本次派工唯一标识：1–160 字，只用 ASCII 字母、数字、下划线或连字符。结果不确定时复用同一标识与参数；新派工使用新标识。' },
      }, required: ['memberId', 'task', 'requestId'] } },
    { name: 'team_read', description: '读取成员状态和未确认的结果回执，不自动消费结果。', parameters: { type: 'object', properties: {}, required: [] } },
    { name: 'team_wait', description: '等待当前工作队任务，最多30秒后返回最新状态和结果；running 表示尚未完成。可被人类停止。', parameters: { type: 'object', properties: {}, required: [] } },
    { name: 'team_ack', description: '确认已经处理的结果回执。reportIds 是 JSON 字符串数组。', parameters: { type: 'object', properties: { reportIds: string }, required: ['reportIds'] } },
    { name: 'team_review', description: '记录对一次回报的判断，不启动执行。accepted=结果满足本次派工目标，continue=需要后续工作，blocked=受阻。结论属于该回报；新情况通过后续派工继续。重复提交相同结论幂等，不覆盖历史判断。普通收取回报仍可用 team_ack，不代表验收通过。',
      parameters: { type: 'object', properties: { reportId: string,
        decision: { type: 'string', description: 'accepted | continue | blocked；执行端校验。' },
        reason: { type: 'string', description: '判断依据或尚需处理的问题。' },
      }, required: ['reportId', 'decision', 'reason'] } },
    { name: 'team_dismiss', description: '解散空闲成员。保留只读历史，旧成员不能重新启用。', parameters: { type: 'object', properties: { memberId: string }, required: ['memberId'] } },
  ];
}

export function teamExtension(runtime: TeamRuntime, policy: TeamPermissions) {
  return { definitions: teamToolDefs(), createHandoff: (emit?: (event: TeamActivityEvent) => void) => createTeamHandoff(runtime, emit), call: async (name: string, args: Record<string, string>, signal?: AbortSignal): Promise<string> => {
    if (signal?.aborted) throw new Error('TEAM_CALL_ABORTED');
    switch (name) {
      case 'team_start': {
        const definition = { name: args.name, mission: args.mission ?? args.name,
          rolePrompt: args.rolePrompt ?? '', taskContext: args.taskContext ?? '',
          constraints: args.constraints ?? '', permissions: policy };
        return JSON.stringify(await runtime.startNew(definition, args.task, policy, args.requestId));
      }
      case 'team_create': {
        const member = await runtime.store.create({ ...args, permissions: policy }, policy);
        return JSON.stringify({ memberId: member.id, name: member.name });
      }
      case 'team_dispatch': {
        if (typeof args.requestId !== 'string' || !args.requestId.trim()) throw new Error('TEAM_INVALID_REQUEST_ID');
        return JSON.stringify(await runtime.dispatch(args.memberId, args.task, policy, args.requestId));
      }
      case 'team_wait': await runtime.waitBriefly(signal); break;
      case 'team_read': break;
      case 'team_review': await runtime.review(args.reportId, args.decision, args.reason); return 'Review recorded. No execution started.';
      case 'team_dismiss': await runtime.store.dismiss(args.memberId); return 'Member dismissed.';
      case 'team_ack': {
        const ids: unknown = JSON.parse(args.reportIds);
        if (!Array.isArray(ids) || !ids.every(id => typeof id === 'string')) throw new Error('TEAM_INVALID_REPORT_IDS');
        await runtime.acknowledge(ids); return 'Reports acknowledged.';
      }
      default: throw new Error('TEAM_UNKNOWN_TOOL');
    }
    const state = await runtime.store.read();
    return JSON.stringify({ members: state.members.map(({ id, name, mission, lifecycle, run }) => ({ id, name, mission, lifecycle, run })),
      reports: state.reports.filter(report => !report.acknowledged),
      latestReviews: state.reports.filter(report => report.review).slice(-20).map(({ id, memberId, runId, review }) => ({ id, memberId, runId, review })) });
  } };
}
