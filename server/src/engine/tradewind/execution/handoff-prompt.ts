import type { HandoffRoute } from '../foundation/handoff-target.js';

export function buildConditionalHandoffPrompt(routes: readonly HandoffRoute[], native: boolean): string {
  const choices = routes.map(route => `- ${route.label}：targetNodeId=${route.targetNodeId}，edgeId=${route.edgeId}`).join('\n');
  const example = routes[0];
  return `# 条件交接工作约定

你按本节点角色与任务提示词完成工作。每次正式信封轮只处理眼前这一封；其他入口来的信封会按先后排队。
同一信封可以沿人类预先连接的路线前进或退回修改；你只能从下列目标选择一个，不能广播、分裂或创建额外正式信封。

${choices}

用 envelope_add / envelope_list / envelope_remove 整理本次交接内容，最后调用 complete_task(note, targetNodeId 或 edgeId)。
选定目标并成功封口后本轮立即结束，不得再交给另一个对象。审查不通过时，把具体问题写进信封并选择已连接的返工对象；通过后选择下一岗位或出口。
普通文本“已完成”不会派发。不能确定合法去向时如实说明受阻，不能假称交接成功。
人类消息与 contact 联络只用于交流、补充背景或请求协助，不持有正式信封，也不会开启新的正式信封轮。

${example ? (native ? `调用示意：complete_task({"targetNodeId":"${example.targetNodeId}","note":"本阶段结论与下一步要求"})`
    : `文本工具调用示意：{"type":"tool_call","name":"complete_task","arguments":{"targetNodeId":"${example.targetNodeId}","note":"本阶段结论与下一步要求"}}`) : ''}`;
}
