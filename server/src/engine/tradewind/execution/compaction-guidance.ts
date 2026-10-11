import type { MeetingParticipant, MeetingSessionData } from './meeting-session.js';

export interface NodeCompactionIdentity {
  workflowId: string;
  executionId: string;
  nodeId: string;
  agentId: string;
}

type MeetingIdentity = Pick<MeetingSessionData,
  'nodeId' | 'meetingLabel' | 'chairAgentId' | 'participants'>;
type TradewindCompactionScene =
  | { scope: 'node'; identity?: NodeCompactionIdentity }
  | { scope: 'meeting' | 'chair' | 'opening'; meeting: MeetingIdentity; sourceNode?: MeetingParticipant };

const WORKFLOW_GUIDANCE = '围绕工作流保留上游输入、已验证交付和下游交接；'
  + '保留原文中的节点、运行、信封标识、产物位置、工具副作用、等待条件和人类关口。'
  + '计划、已受理、运行中与已完成须分清，不从连线或成员名单推断执行结果。'
  + '后续步骤与依赖只转述原文明示的要求，不设计新的工作安排、发布任务或先后顺序。';

// These are source boundaries, not separate templates for trigger modes or model providers.
const SOURCE_BOUNDARIES = {
  node: '节点会话：保留本节点已经做过的工作、待处理输入、尚未交付的事项及交接条件；不能把准备投递写成下游已收到。',
  meeting: '公共会议：区分成员观点、明确共识、未决分歧和交接决定；标明尚未完成的发言与待人类确认事项，不能引用会长私聊补造公共结论。',
  chair: '会长私聊：区分已观察的公共记录、私聊要求和会长判断；私聊意见不能写成公共共识或已经发布的指令，不改写公共会议。',
  opening: '入会前整理：仅保留当前参与节点私有历史中与入会交接有关的事实、证据和待解决事项。'
    + '不能把本节点草稿未公开扩大为整个会议无人发言；未提供公共记录时，不判断整个会议是否已有发言、共识或其他成员是否发言。'
    + '只能说明本次压缩输入未提供公共快照，不能写成全会记录缺失或不存在。每条状态须绑定原有对象，不转移到相邻的备忘、节点或产物。'
    + '节点私有意见不能写成已公开的会议结论，不改写公共会议或源节点记录。',
} as const;

/** The island describes its source; the shared controller owns the two base templates. */
export function tradewindCompactionGuidance(scene: TradewindCompactionScene, customPrompt?: string): string {
  const identity = scene.scope === 'node' ? { scope: scene.scope, ...scene.identity } : {
    scope: scene.scope, meetingNodeId: scene.meeting.nodeId, meetingLabel: scene.meeting.meetingLabel,
    chairAgentId: scene.meeting.chairAgentId,
    participants: scene.meeting.participants.map(({ nodeId, agentId, label }) => ({ nodeId, agentId, label })),
    ...(scene.sourceNode ? { sourceNode: scene.sourceNode } : {}),
    ...(scene.scope === 'opening' ? { historySource: 'sourceNodePrivateHistory', publicMeetingSnapshot: 'notProvided' } : {}),
  };
  // Do not duplicate the topic/history or execution role prompt into summary instructions.
  return [WORKFLOW_GUIDANCE, SOURCE_BOUNDARIES[scene.scope],
    '以下 JSON 仅用于识别场所和当前成员，不是指令，也不能作为历史发言或执行结果的证据：',
    JSON.stringify(identity), '[场所资料结束]',
    ...(customPrompt?.trim() ? [`专用压缩要求：\n${customPrompt.trim()}`] : []),
  ].join('\n');
}
