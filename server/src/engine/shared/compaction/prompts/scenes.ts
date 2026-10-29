import type { CompactionArea } from '../contracts.js';

/** Scene guidance belongs to compaction; islands provide identities and facts, not copied templates. */
export const COMPACTION_SCENES: Record<CompactionArea, string> = {
  monsoon: '季风会话：保留人类当前目标、主 Agent 的工作进度、工作队派发、待收回报及必要的接续线索。',
  tide: '潮汐任务：保留任务目标、本次与历史执行的区别、计划配置、运行结果及未完成事项，不把计划触发当作已执行。',
  cycloneConversation: '气旋私聊：保留当前工作室、工位或主管的身份与职责，记录本项目的工作进度、协作派发及等待的回报。',
  cycloneMeeting: '气旋群聊：按议题整理成员观点、共识、分歧和待办，保留讨论轮次、发言身份及工位之间的协作关系。',
  tradewindConversation: '信风节点：保留工作流、运行和节点身份，上游输入、当前节点进度、下游交接及信封与产物线索。',
  tradewindMeeting: '信风会议：保留所属工作流与运行、会议任务、成员观点、形成的结论和下游交接，不混入其他节点或运行。',
  convection: '对流讨论：按议题保留成员观点、共识、分歧、待确认事项和后续讨论线索，保持公共讨论与助理私聊的来源区分。',
};

export const MEETING_HANDOFF_PROMPT = '会议记录须标明尚未完成发言或等待回复的成员；缺席、沉默、受理或未完成回复不能视为同意，不为达成共识补造结论。';
