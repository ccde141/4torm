import type { ToolDef } from '../shared/tool-defs-loader.js';

/** 只调整主入口的行为说明，参数与执行协议保持不变。 */
export function withMainToolGuidance(defs: ToolDef[]): ToolDef[] {
  const descriptions: Record<string, string> = {
    memory_write: '记录跨会话仍有价值的偏好、约定、已验证结论和失败原因。先 memory_list 检查重复，不把临时状态与猜测作为长期事实。',
    task_board: '维护本会话任务板。按需要记录目标、步骤与实际进度；set 为整板替换，set/clear 需 expectedRevision，冲突后先读取再合并。',
    update_workflow: '修改已有工作流（整图替换）。在已有授权范围内修改；先 list_workflows 读取完整结构，保留未改动节点，提交完整 name/nodes/edges。',
  };
  return defs.map(def => descriptions[def.name]
    ? { ...def, description: descriptions[def.name] } : def);
}

export function renderMainToolDefinitions(defs: ToolDef[]): string {
  return defs.map(def => `#### ${def.name}\n${def.description}\n参数 JSON Schema：\n${JSON.stringify(def.parameters ?? {})}`).join('\n\n');
}

export const MAIN_WORKFLOW_CONTRACT = `信风结构规则：
- 必须是 DAG，无循环；Entry 必须存在，Output 有且只有一个。
- 多条出边是复制广播，不是条件分叉；多上游汇聚后拼接结果。
- human-gate 是人类可编辑内容的线性暂停点，不支持批准/打回分支。
- nodes 通用字段为 id、type、label；label 使用体现职责的人类可读名称。
- entry: initialEnvelope；agent: agentId（真实全局 Agent ID）、role、deliveryDelaySec（默认0）。
- meeting: chairAgentId、participantNodeIds（同图 agent 节点 ID，不是 Agent ID）。
- note: content、targets（目标节点 ID）；human-gate/output 无专属字段。
- edges 为 {source,target}；先 list_agents 核实 Agent，缺少实体时请人类创建。
- update_workflow 整图替换，先读取现有结构，保留未修改内容；布局按节点 ID 沿用。
- 仅在请求明确要求执行时启动；启动冲突不重试、不停止现有工作流。`;
