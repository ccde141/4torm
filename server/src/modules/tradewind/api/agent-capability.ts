import type { FrameworkCapabilityDescriptor } from '../../../shared/framework-capability.js';

export const TRADEWIND_AGENT_CAPABILITY: FrameworkCapabilityDescriptor = {
  id: 'tradewind',
  title: '信风工作流',
  route: '需要固定节点、上下游交接、人类关口或可重复流程；搭建与启动分开。',
  guidance: `### 信风工作流
根据实际需要查看、创建或调整结构。区分搭建与启动：请求搭建工作流，不自动意味着要求立即执行。

结构规则：
- 必须是 DAG，无循环；Entry 必须存在，Output 有且只有一个。
- 多条出边是复制广播，不是条件分叉；多上游汇聚后拼接结果。
- human-gate 是人类可编辑内容的线性暂停点，不支持批准/打回分支。
- nodes 通用字段为 id、type、label；label 使用体现职责的人类可读名称。
- entry: initialEnvelope；agent: agentId、role、deliveryDelaySec（默认0）。
- meeting: chairAgentId、participantNodeIds（同图 agent 节点 ID）。
- note: content、targets（目标节点 ID）；human-gate/output 无专属字段。
- edges 为 {source,target}；先 list_agents 核实 Agent，缺少实体时请人类创建。
- update_workflow 整图替换，先读取现有结构，保留未修改内容；布局按节点 ID 沿用。
- 仅在请求明确要求执行时启动；启动冲突不重试、不停止现有工作流。
- 已启动后用执行 ID 观察或等待真实状态；需要节点细节时按工作流、执行和节点 ID 限量读取。
- 给节点发话后只视为入队，继续观察确认处理结果；人类关口仍由人类处理。
- 会议节点分别读取公共讨论与会长私聊；公开发言、调整成员或结束会议前，先核对当前执行与阶段。`,
  examples: [{ scenario: '搭建内容梳理、审阅、人类编辑关口的可重复流程',
    actions: ['list_agents', 'create_workflow', 'list_workflows'],
    confirmation: '核对已保存的工作流结构；仅要求搭建时不启动运行。' }],
};
