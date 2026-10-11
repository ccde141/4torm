import type { FrameworkCapabilityDescriptor } from '../../../shared/framework-capability.js';

export const CYCLONE_AGENT_CAPABILITY: FrameworkCapabilityDescriptor = {
  id: 'cyclone',
  title: '气旋协作组',
  route: '需要固定工位、共享工作区和群聊来持续协作；建立结构后按需启动协作轮次。',
  actionGuide: true,
  guidance: `### 气旋协作组
需要持久的多 Agent 工位、共享工作区和群聊时，可以创建气旋协作组。工作队适合当前会话内的临时分工；信风适合固定节点流转；气旋适合持续协作结构。

创建前先确认要绑定的全局 Agent 已存在。创建成功只表示工作室、工位和群聊已经完整发布，不会自动启动成员执行。明确要求执行时，保留运行句柄、等待真实终态并回读相应会话。

选择协作场所：独立调查、编写和多步骤执行交给固定工位私聊；分别启动工位任务、等待终态，再读取各工位回报。群聊可先同步共同背景，也可直接把背景写进工位任务；群聊用于讨论、共享必要信息和整合简报，公告板保存需全体知晓的结论。也可以先在群聊讨论，再用 dispatch 把明确事项交给固定工位。不要让多个群聊分身在同一轮中串行完成重活：过程会挤占公共上下文，工位私聊也不会保存这段执行。简单问答和纯信息交流可以直接在群聊完成。

历史消息改写和删除、实体删除、上下文重置及主动压缩由人类在界面操作，未向你开放。需要这些操作时向人类说明目标和影响，请人类执行；不要借其他工具绕过此边界。`,
  examples: [
    { scenario: '为长期协作建立固定工位和共享工作区',
      actions: ['create_collaboration_group', 'read_collaboration_group'],
      confirmation: '回读工位与成员；结构已创建不代表成员已经开始执行。' },
    { scenario: '两位工位分别承担独立调查，再汇总共享结论',
      actions: ['read_collaboration_group', 'start_collaboration_seat_chat', 'read_collaboration_thread'],
      confirmation: '逐个工位启动并保留运行 ID；等待终态后读取各自私聊回报，再把必要结论同步到群聊或公告板。' },
  ],
};
