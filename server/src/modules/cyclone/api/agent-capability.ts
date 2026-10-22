import type { FrameworkCapabilityDescriptor } from '../../../shared/framework-capability.js';

export const CYCLONE_AGENT_CAPABILITY: FrameworkCapabilityDescriptor = {
  id: 'cyclone',
  title: '气旋协作组',
  route: '需要固定工位、项目记忆、共享工作区、群聊或工作室主管来持续协作；按真实状态接续任务。',
  actionGuide: true,
  guidance: `### 气旋协作组
需要持久的多 Agent 工位、共享工作区和群聊时，可以创建气旋协作组。工作队适合当前会话内的临时分工；信风适合固定节点流转；气旋适合持续协作结构。

创建前先确认要绑定的全局 Agent 已存在。创建成功只表示工作室、工位和群聊已经完整发布，不会自动启动成员执行。需要主管时，在 create_collaboration_group 中明确填写 supervisorAgentId，可选 supervisorRolePrompt；不填则不配置主管。主管与群聊会议助理 chairAgentId 是两种独立角色，可以绑定同一池化 Agent。明确要求执行时，保留运行句柄、等待真实终态并回读相应会话。

工位是本项目中的持续工作单元：绑定 Agent 提供模型、基础角色、工具、技能和通用记忆；工位保留自己的职责、私聊、项目记忆和事项记录。更换绑定 Agent 不会清空岗位积累。岗位经验和项目资料由工位写入本工位记忆，适合跨项目复用的经验才进入池中 Agent 的通用记忆；记忆不代替真实运行状态。

接续已有工作室时，先用 read_collaboration_console 查看项目统计、工位概况和近期事项；指定 seatId 再看该工位职责、继承能力与协作设置。按需用 read_collaboration_seat_memory 读取记忆索引，选中条目后携带返回的 revision 和 entryId 分段读取正文。这里是跨工位统筹入口，每次都要填写真实 workshopId，读取工位资料时还需 seatId；不会从上一次调用自动继承身份。首次使用某个 action 前，用 framework_guide({capability:"cyclone",action:"操作名"}) 核对字段。

读取示例（ID 均取实际返回值）：先以 action=read_collaboration_console、input={workshopId} 找到工位；再以 action=read_collaboration_seat_memory、input={workshopId,seatId} 取索引；需要正文时仍用同一 action，input={workshopId,seatId,entryId,revision}。不要只传 seatId，也不要把索引中的标题猜成 entryId。需要执行细节时继续读取私聊、派发或运行记录，不把概况或记忆当作完成凭据。按返回游标续读；记录变化时重新定位，不拼接不同版本。

完整工位履历使用 read_collaboration_seat_history，按 workshopId、seatId 和返回游标读取。执行、联络、派发、岗位配置、绑定与记忆变更是不同事项；不能把一条配置变更当作任务完成。概况中的近期事项不代表完整履历。

选择协作场所：独立调查、编写和多步骤执行交给固定工位私聊；分别启动工位任务、等待终态，再读取各工位回报。群聊可先同步共同背景，也可直接把背景写进工位任务；群聊用于讨论、共享必要信息和整合简报，公告板保存需全体知晓的结论。也可以先在群聊讨论，再用 dispatch 把明确事项交给固定工位。不要让多个群聊分身在同一轮中串行完成重活：过程会挤占公共上下文，工位私聊也不会保存这段执行。简单问答和纯信息交流可以直接在群聊完成。

工位交办用 action=start_collaboration_seat_chat、input={workshopId,seatId,text:"具体任务与完成标准"}；text 是本次要发给工位的正文。启动回执不是交付，按运行句柄等待完成后，再用 read_collaboration_thread 读取 target="seat"、targetId=seatId 的私聊回报。

工作室主管负责本工作室的统筹、结构调整与交付跟进，保持一段持续会话。用 read_collaboration_supervisor 查看配置、忙态、待回答问题和收件情况；已建工作室尚未配置主管时，可用 configure_collaboration_supervisor 首次绑定。此工具不替换已有主管，需要换绑时请人类处理。

主管收件列表是预览；contentTruncated 为 true 时，用同一 read_collaboration_supervisor 的 informationId、revision、offset 分段读取正文。沿用 nextCursor 或 nextOffset，不把预览当作完整回报；记录变化后重新读取。

向主管转达已获授权的项目目标，用 start_collaboration_supervisor_chat；先通过 framework_guide 核对字段。框架记录你作为委托 Agent 的真实来源，不填写或伪造人类来源。绑定本身不启动执行，工位 supervisor_message 上报也不建立新目标。目标建立后主管才能按回执继续跟进；工位只向主管发信息，不向主管派活。主管忙碌或等待人类回答时，不插队、不代答、不自动重试。

主管会话用 read_collaboration_thread/message，target="supervisor"、targetId="supervisor"，workshopId 始终填写所属工作室。按运行句柄等待并回读回复、工位交付和回执；收件已送达不等于主管已处理，主管本轮结束也不等于所有派发都已交付。

跨工作室的统筹入口对已有工位配置、继承能力和工位记忆只提供读取，不修改绑定 Agent、岗位配置或协作开关，也不跨工位写记忆。工作室主管通过自己的项目内工具管理所属工作室；不要借其他入口绕过外部统筹工具的边界。

历史消息改写和删除、实体删除、上下文重置及主动压缩由人类在界面操作，未向你开放。需要这些操作时向人类说明目标和影响，请人类执行；不要借其他工具绕过此边界。`,
  examples: [
    { scenario: '为长期协作建立固定工位和共享工作区',
      actions: ['create_collaboration_group', 'read_collaboration_group'],
      confirmation: '回读工位与成员；结构已创建不代表成员已经开始执行。' },
    { scenario: '建立带主管的工作室，并转达项目目标让主管持续跟进',
      actions: ['create_collaboration_group', 'read_collaboration_console', 'read_collaboration_supervisor',
        'start_collaboration_supervisor_chat', 'read_collaboration_thread'],
      confirmation: '创建时明确选择主管，回读配置后再交办。按运行句柄核对主管回复、工位派发与实际交付，不把配置成功或信息送达当作任务完成。' },
  ],
};
