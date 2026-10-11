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
