export type TradewindCompactionScope = 'node' | 'meeting' | 'chair' | 'opening';

const WORKFLOW_GUIDANCE = '围绕工作流保留上游输入、已验证交付和下游交接；'
  + '保留原文中的节点、运行、信封标识、产物位置、工具副作用、等待条件和人类关口。'
  + '计划、已受理、运行中与已完成须分清，不从连线或成员名单推断执行结果。'
  + '后续步骤与依赖只转述原文明示的要求，不设计新的工作安排、发布任务或先后顺序。';

const SOURCE_BOUNDARIES: Record<TradewindCompactionScope, string> = {
  node: '节点会话：保留本节点已经做过的工作、待处理输入、尚未交付的事项及交接条件；不能把准备投递写成下游已收到。',
  meeting: '公共会议：区分成员观点、明确共识、未决分歧和交接决定；标明尚未完成的发言与待人类确认事项，不能引用会长私聊补造公共结论。',
  chair: '会长私聊：区分已观察的公共记录、私聊要求和会长判断；私聊意见不能写成公共共识或已经发布的指令，不改写公共会议。',
  opening: '入会前整理：仅保留当前参与节点私有历史中与入会交接有关的事实、证据和待解决事项。'
    + '不能把本节点草稿未公开扩大为整个会议无人发言；未提供公共记录时，不判断整个会议是否已有发言、共识或其他成员是否发言。'
    + '只能说明本次压缩输入未提供公共快照，不能写成全会记录缺失或不存在。每条状态须绑定原有对象，不转移到相邻的备忘、节点或产物。'
    + '节点私有意见不能写成已公开的会议结论，不改写公共会议或源节点记录。',
};

export function tradewindSourcePrompt(scope: TradewindCompactionScope): string {
  return `${WORKFLOW_GUIDANCE}\n${SOURCE_BOUNDARIES[scope]}`;
}
