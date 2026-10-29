import { useLocale } from '../../../i18n/LocaleContext';

const zh = {
  title: '工作流', create: '新建', search: '搜索工作流', refresh: '刷新工作流',
  strict: '严格依赖', handoff: '条件交接', modes: '流转方式', loading: '正在读取工作流…',
  empty: '还没有工作流', noMatches: '没有匹配的工作流', unsupported: '此模式暂不能新建工作流',
  delete: '删除工作流', confirmDelete: '确认删除', cancel: '取消', deleting: '正在删除…',
  deleteTitle: '删除工作流「{name}」？',
  deleteFailed: '删除工作流失败', deleteWarning: '将删除此工作流、工作区文件、循环配置，以及全部运行记录和会话归档。此操作无法撤回。',
  nodes: '节点', draft: '本地草稿', unsaved: '尚未保存',
  design: '编排', run: '运行', records: '运行记录', workspace: '工作流视图',
  help: '了解流转方式与运行方式', closeHelp: '关闭说明', helpTitle: '流转与运行',
  strictHelp: '按固定依赖推进。节点收齐全部上游信封后开工，完成后把结果交给预设下游。',
  strictUse: '例如：资料检查、表达检查分别完成 → 汇总 → 交付。',
  handoffHelp: '按任务结果选路。节点一次处理一封信封，只选一个已连接的目标交接，也可退回修改。多个入口的信封按到达顺序排队，交接不分裂信封。',
  handoffUse: '例如：制作 → 审查 → 通过后交付，未通过退回制作。',
  execution: '运行方式',
  interactiveHelp: '从入口自动推进，你可在执行中交流、暂停，并在暂停点确认后继续。',
  unattendedHelp: '流程不依赖暂停点或会议；可运行一次，也可按配置重复运行。',
  runUse: '两种流转方式均可选择运行方式。条件交接不支持会议节点。返工属于同一次运行；循环运行是在本次完成后重新从入口开始。',
  contactHelp: '两种流转方式都允许 Agent 联络。联络用于交流，不代替信封交接。',
  runDock: '活跃工作流', queued: '排队中', running: '运行中', waiting: '等待中', paused: '已暂停',
  completed: '已完成', aborted: '已中止', failed: '失败', crashed: '异常结束',
};

type WorkspaceCopy = { [K in keyof typeof zh]: string };

const en: WorkspaceCopy = {
  title: 'Workflows', create: 'New', search: 'Search workflows', refresh: 'Refresh workflows',
  strict: 'Strict dependencies', handoff: 'Conditional handoff', modes: 'Flow type',
  loading: 'Loading workflows…', empty: 'No workflows yet', noMatches: 'No matching workflows',
  unsupported: 'Creating workflows in this mode is not available yet',
  delete: 'Delete workflow', confirmDelete: 'Confirm delete', cancel: 'Cancel', deleting: 'Deleting…',
  deleteTitle: 'Delete workflow “{name}”?',
  deleteFailed: 'Could not delete workflow', deleteWarning: 'This deletes the workflow, workspace files, repeat settings, and all run records and conversation archives. This cannot be undone.',
  nodes: 'nodes', draft: 'Local draft', unsaved: 'Not saved yet',
  design: 'Design', run: 'Run', records: 'Run history', workspace: 'Workflow view',
  help: 'Understand flow types and run options', closeHelp: 'Close help', helpTitle: 'Flow and execution',
  strictHelp: 'Follow fixed dependencies. A node waits for all upstream envelopes, then passes its results to preset downstream nodes.',
  strictUse: 'Example: research check + language check → consolidation → delivery.',
  handoffHelp: 'Choose a route based on the result. A node handles one envelope at a time and hands it to one connected target, including a return path for revisions. Envelopes from multiple entries are queued in arrival order and never split.',
  handoffUse: 'Example: create → review → deliver if approved, or return for revisions.',
  execution: 'Run options',
  interactiveHelp: 'Advances automatically from the entry. Chat, pause, and approve pause points as it runs.',
  unattendedHelp: 'Runs without depending on pause points or meetings. Run once or repeat using a saved configuration.',
  runUse: 'Both flow types support either run option. Conditional handoff does not support meeting nodes. Revisions stay within the same run; a repeated run starts again from the entry after the previous run finishes.',
  contactHelp: 'Both flow types allow Agent contact for communication. Contact does not replace envelope handoff.',
  runDock: 'Active workflows', queued: 'Queued', running: 'Running', waiting: 'Waiting', paused: 'Paused',
  completed: 'Completed', aborted: 'Aborted', failed: 'Failed', crashed: 'Interrupted',
};

export function useWorkspaceCopy() {
  const { locale } = useLocale();
  return { copy: locale === 'zh-CN' ? zh : en, locale };
}
