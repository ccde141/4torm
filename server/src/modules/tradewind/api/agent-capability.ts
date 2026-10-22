import type { FrameworkCapabilityDescriptor } from '../../../shared/framework-capability.js';

export const TRADEWIND_AGENT_CAPABILITY: FrameworkCapabilityDescriptor = {
  id: 'tradewind',
  title: '信风工作流',
  route: '需要固定节点、上下游交接、人类关口或可重复流程；搭建与启动分开。',
  guidance: `### 信风工作流
根据实际需要查看、创建或调整结构。区分搭建与启动：请求搭建工作流，不自动意味着要求立即执行。

编排类型由 orchestration 指定，省略为 strict；manual/auto 是独立的运行方式，不是第三种编排类型。
两类均至少有一个 Entry 和唯一 Output，不同工作流可以同时运行。按 workflowId/executionId 区分，不停止其他工作流。

严格依赖（strict）：
- 必须是 DAG；多条出边复制广播，多上游全部到齐后拼接输入。
- human-gate 是人类可编辑内容的线性暂停点，不支持批准/打回分支。

条件交接（handoff）：
- 每个入口生成一份正式信封，身份沿途不变，不复制、不分裂。入口和人类关口各连接一个继续对象。
- 节点按接收先后逐封处理，一次只处理一封；多个入口可以各有一封排队。
- Agent 完成本节点任务后调用 complete_task，用 targetNodeId 或 edgeId 选择一个已连接目标；允许沿人类预设回边返工。
- 人类与 contact 联络不创建新正式信封；所有入口信封到达出口后整次运行才完成。
- 不支持会议节点，不加入自动会议。节点职责直接放 role 提示词，不另造职责配置表。

共同结构与操作：
- nodes 通用字段为 id、type、label；label 使用体现职责的人类可读名称。
- entry: initialEnvelope；agent: agentId、role、deliveryDelaySec（默认0）。
- meeting: chairAgentId、participantNodeIds（同图 agent 节点 ID）。
- note: content、targets（目标节点 ID）；output 可填 archiveName（归档文件名，不含路径和后缀）；human-gate 无专属字段。
- edges 为 {source,target}；先 list_agents 核实 Agent，缺少实体时请人类创建。
- list_workflows 用于定位工作流和读取摘要，指定 ID 的旧接口仍可能截断，不能据此重建大图。
- update_workflow 整图替换；先用 read_workflow({workflowId}) 获取完整编排正文。text 可能只是 JSON 的一段，返回 nextOffset 时携带原 revision 续读，直到没有 nextOffset 再拼接解析；版本变化从 0 重读，不拼接不同版本。
- 更新时提交完整 name、orchestration、nodes、edges 并保留未改字段，以读取的 revision 填 expectedRevision；布局、尺寸、备注及未改连线信息沿用现有画布。
- 创建或更新后，优先 validate_workflow({workflowId,mode?}) 校验已保存图，返回 valid/issues；无需把简化 spec 重拼成 graph。也可传完整画布 graph，与 workflowId 二选一。
- 人类与 Agent 共用同一权威校验，启动前仍重新校验；校验失败先定位 issues 中的节点或连线，不用自然语言假称已通过。
- 仅在请求明确要求执行时启动；启动冲突不重试、不停止现有工作流。
- 已启动后用执行 ID 观察或等待真实状态；需要节点细节时按工作流、执行和节点 ID 限量读取。
- 人类授权停止本次执行时可调用 stop_workflow，必须携带观察到的 executionId，只影响这次执行。
- 处理节点中的异常先读当前状态与节点会话，核对 executionId、nodeId 和 runId；abort_workflow_node_round 仅中止普通发话轮。pause_workflow_node_round 结束当前信封或联络轮并保留信封，不能当作整张图暂停。
- 恢复时重新读取节点状态，将 pausedRunId 作为 resume_workflow_node_round 的 runId；恢复会重跑暂停的轮次，不是从原输出断点继续。人工关口仍由人类提交，不能用节点控制绕过。
- 节点控制返回 accepted 只表示命令已接收，继续读取节点确认 paused/pausedRunId 或新轮次状态；不能把回执当成暂停或恢复已经完成。
- 配置重复运行时，先 list_workflow_profiles 获取现有档案与 revision，再 save_workflow_profile 保存单个档案并填写 expectedRevision，保留其他档案。文本正文返回 nextOffset 时，续读同时携带原 revision；版本变化则重新定位，不拼接不同版本。字段以 framework_guide 的实时 schema 为准；只支持已实现的相对间隔循环，不把预留定时类型当作已可执行。
- 档案保存不启动运行；明确授权执行后，start_workflow 显式填写 mode="auto" 和真实 profileId。带 profileId 的请求不能省略 auto 或使用 manual。返工属于同次运行，循环档案控制下一圈入口任务。
- 查看历史时，用 list_workflow_runs 按 workflowId 分页定位，再 read_workflow_run 查看本次结果，read_workflow_run_events 查看交接事件，read_workflow_run_archive 分段读取归档会话、工具与信封。运行详情和归档正文续读携带 revision 和 nextOffset，事件列表沿用 nextCursor。按返回的运行、节点和归档标识定位，不猜文件路径，不把概览当成完整正文。
- 给节点发话后只视为入队，继续观察确认处理结果；人类关口仍由人类处理。
- 会议节点分别读取公共讨论与会长私聊；公开发言、调整成员或结束会议前，先核对当前执行与阶段。`,
  examples: [
    { scenario: '搭建内容梳理、审阅、人类编辑关口的可重复流程',
      actions: ['list_agents', 'create_workflow', 'list_workflows', 'read_workflow'],
      confirmation: '核对已保存的工作流结构；仅要求搭建时不启动运行。' },
    { scenario: '搭建允许返工的条件交接流程，配置重复运行并核对归档结果',
      actions: ['create_workflow', 'validate_workflow', 'list_workflow_profiles', 'save_workflow_profile', 'start_workflow',
        'list_workflow_runs', 'read_workflow_run', 'read_workflow_run_events', 'read_workflow_run_archive'],
      confirmation: '选择 handoff，在节点 role 写清通过与返工条件，并预连修改节点和出口；每次只交接一个目标。先校验图，再读取档案版本并保存单档，按授权启动。按运行标识核对每圈结果、交接事件和归档，不影响其他工作流，也不以配置已保存代替执行完成。' },
  ],
};
