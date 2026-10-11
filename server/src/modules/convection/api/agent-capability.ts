import type { FrameworkCapabilityDescriptor } from '../../../shared/framework-capability.js';

export const CONVECTION_AGENT_CAPABILITY: FrameworkCapabilityDescriptor = {
  id: 'convection',
  title: '对流会议',
  route: '需要让长期 Agent 公开讨论、比较意见或接续已有会议；创建会议与启动发言是不同动作。',
  guidance: `### 对流会议
需要围绕一个议题组织多个长期 Agent 依次讨论时，先用 list_discussions 查已有会议，再按需创建。主席与参与者使用已有的全局 Agent；参与者列表的顺序就是下一轮回复顺序。

用 read_discussion 读取公共讨论；scope=chair 可读取会议助理私聊，空私聊明确返回空列表。回复进行中时会给出内存中的最新文字与未完成提示，不能把它当成最终结论。

会议较长时，先用 list_discussion_rounds 按公开讨论或主席私聊列出轮次，再用 read_discussion_round 按 roundId 读取必要原文。进行中轮次可能含未落盘草稿；旧记录若无法精确关联运行 ID，会明确标识。

start_discussion 的 round=public 向会议发言并启动与会者回复，round=chair 向会议助理私聊。返回的 sessionId 和 runId 可用于 inspect_operation、wait_operation，再读取最终记录。会议运行中不能变更成员或删除；运行结束后可加入、请离或重排下一轮成员。`,
  examples: [{ scenario: '让两名长期 Agent 依次讨论一项方案',
    actions: ['list_discussions', 'create_discussion', 'start_discussion', 'read_discussion'],
    confirmation: '进行中读取的是当前快照；运行结束后再核对最终发言。' }],
};
