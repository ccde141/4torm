import { agentConfigEn, agentConfigZh } from './agent-config-messages';
import { chatEn, chatZh } from './chat-messages';
import { taskboardEn, taskboardZh } from './taskboard-messages';
import { chatPageEn, chatPageZh } from './chat-page-messages';
import { convectionEn, convectionZh } from './convection-messages';
import { cycloneEn, cycloneZh } from './cyclone-messages';
import { cycloneSeatEn, cycloneSeatZh } from './cyclone-seat-messages';
import { cycloneShellEn, cycloneShellZh } from './cyclone-shell-messages';
import { cycloneBulletinEn, cycloneBulletinZh } from './cyclone-bulletin-messages';
import { cycloneRoomEn, cycloneRoomZh } from './cyclone-room-messages';
import { cycloneSeatChatEn, cycloneSeatChatZh } from './cyclone-seat-chat-messages';
import { tradewindShellEn, tradewindShellZh } from './tradewind-shell-messages';
import { tradewindConfigEn, tradewindConfigZh } from './tradewind-config-messages';
import { tradewindProfileEn, tradewindProfileZh } from './tradewind-profile-messages';
import { tradewindInfoEn, tradewindInfoZh } from './tradewind-info-messages';
import { tradewindChatEn, tradewindChatZh } from './tradewind-chat-messages';
import { tradewindMeetingEn, tradewindMeetingZh } from './tradewind-meeting-messages';
import { tradewindCanvasEn, tradewindCanvasZh } from './tradewind-canvas-messages';
import { tideEn, tideZh } from './tide-messages';
import { toolsEn, toolsZh } from './tools-messages';
import { skillsEn, skillsZh } from './skills-messages';
import { mcpEn, mcpZh } from './mcp-messages';
import { modelSettingsEn, modelSettingsZh } from './model-settings-messages';
import { dashboardEn, dashboardZh } from './dashboard-messages';
import { compactionEn, compactionZh } from './compaction-messages';

export type Locale = 'zh-CN' | 'en-US';

export const DEFAULT_LOCALE: Locale = 'zh-CN';
export const LOCALE_STORAGE_KEY = '4torm.ui.locale';

const coreZh = {
  'nav.workspace': '工作台',
  'nav.capabilities': '能力',
  'nav.configuration': '配置',
  'nav.links': '链接',
  'nav.console': '控制台',
  'nav.monsoon': '季风 · 智能体对话',
  'nav.convection': '对流 · 多方会议室',
  'nav.cyclone': '气旋 · 团队协作室',
  'nav.tradewind': '信风 · 工作流编排',
  'nav.tide': '潮汐 · 自动化任务',
  'nav.tools': '工具',
  'nav.skills': '技能',
  'nav.models': '模型',
  'nav.expand': '展开功能区',
  'nav.collapse': '收起功能区',
  'nav.bugReport': 'Bug 反馈',
  'nav.repository': '项目地址',
  'nav.blog': 'B站空间',
  'locale.label': '界面语言',
  'locale.zh': '中文',
  'locale.en': 'English',
  'header.search': '搜索 Agent、季风、工作室、潮汐…',
  'header.searchLabel': '搜索',
  'header.noResults': '未找到结果',
  'header.docs': '使用文档',
  'header.skin': '打开皮肤设置',
  'common.cancel': '取消',
  'common.confirm': '确定',
  'common.save': '保存',
  'common.delete': '删除',
  'common.edit': '编辑',
  'common.loading': '加载中…',
  'agent.configure': '配置 Agent',
  'agent.memory': '长期记忆',
  'agent.model': '模型',
  'agent.workspace': '工作区',
  'agent.notSelected': '未选择',
  'agent.copyWorkspace': '{path}（点击复制）',
  'agent.deleteWarning': '工作区与对话信息将被清空，确认删除?',
  'agent.deleting': '正在删除…',
  'agent.deleteFailed': '删除 Agent 失败：{detail}',
  'agent.tabBasic': '基本',
  'agent.tabPrompt': '提示词',
  'agent.tabTools': '工具',
  'agent.tabSkills': '技能',
  'agent.avatarLabel': '{name}的头像',
  'avatar.preview': '待保存的 Agent 头像',
  'avatar.label': '头像',
  'avatar.hint': '自动居中裁切并保存为 256px WebP',
  'avatar.processing': '处理中…',
  'avatar.change': '更换图片',
  'avatar.select': '选择图片',
  'avatar.remove': '移除头像',
  'permission.label': '执行权限',
  'permission.project': '项目级',
  'permission.unrestricted': '无限制',
  'permission.projectHint': '文件工具可访问 4torm 项目和当前工作区，无论工作区位于何处；其他外部路径会被拒绝。',
  'permission.unrestrictedHint': '文件工具可访问任意路径；框架管理数据仍需通过专用工具修改。',
  'memory.feedback': '偏好/纠正',
  'memory.fact': '事实',
  'memory.pitfall': '踩坑',
  'memory.reference': '资源',
  'memory.required': '内容不能为空',
  'memory.prompt': '想让 {agent} 记住什么？',
  'memory.placeholder': '直接把要它记住的事说清楚即可。\n例：本项目所有文件落盘都要用原子写（先写临时文件再改名），别用裸 writeFile。',
  'memory.category': '类别',
  'memory.addTags': '＋ 添加标签',
  'memory.tagsPlaceholder': '标签，逗号分隔（可选，留空即可，系统也会自动补）',
  'memory.hint': '摘要与检索标签交给系统自动整理，专心写内容就好。',
  'memory.title': '🧠 长期记忆',
  'memory.subtitle': '{agent} · 跨会话积累的经验（您可以随时查看与编辑）',
  'memory.close': '关闭长期记忆',
  'memory.add': '＋ 手动新增一条',
  'memory.empty': '还没有任何记忆。Agent 工作中会自动记录，你也可以手动新增。',
  'memory.editLabel': '编辑记忆',
  'memory.deleteLabel': '删除记忆',
  'memory.pending': '待精炼',
  'memory.pendingTitle': '摘要待 Agent 精炼',
  'memory.source': '来源 {source} · 更新 {date}',
  'memory.you': '你',
  'page.agent.title': '控制台',
  'page.agent.subtitle': 'Agent实例管理',
  'page.chat.title': '季风 · 智能体对话',
  'page.chat.subtitle': '与 Agent 信息交互',
  'page.tools.title': '工具',
  'page.tools.subtitle': '全局工具注册与管理',
  'page.skills.title': '技能',
  'page.skills.subtitle': '管理与安装 Agent 能力包',
  'page.convection.title': '对流 · 多方会议室',
  'page.convection.subtitle': '多 Agent 持续协作会话',
  'page.cyclone.title': '气旋 · 团队协作室',
  'page.cyclone.subtitle': '工位私聊与团队协作',
  'page.tradewind.title': '信风 · 工作流编排',
  'page.tradewind.subtitle': '多 Agent 协作工作流',
  'page.tide.title': '潮汐 · 自动化任务',
  'page.tide.subtitle': '定时唤醒 Agent',
  'page.model.title': '模型',
  'page.model.subtitle': '模型提供商与 API 配置',
  'page.mcp.title': 'MCP',
  'page.mcp.subtitle': '外部工具服务管理',
} as const;

const coreEn: Record<keyof typeof coreZh, string> = {
  'nav.workspace': 'Workspace',
  'nav.capabilities': 'Capabilities',
  'nav.configuration': 'Configuration',
  'nav.links': 'Links',
  'nav.console': 'Console',
  'nav.monsoon': 'Monsoon · Chat',
  'nav.convection': 'Convection · Meetings',
  'nav.cyclone': 'Cyclone · Workshops',
  'nav.tradewind': 'Tradewind · Workflows',
  'nav.tide': 'Tide · Automation',
  'nav.tools': 'Tools',
  'nav.skills': 'Skills',
  'nav.models': 'Models',
  'nav.expand': 'Expand navigation',
  'nav.collapse': 'Collapse navigation',
  'nav.bugReport': 'Report a bug',
  'nav.repository': 'Repository',
  'nav.blog': 'Bilibili',
  'locale.label': 'Interface language',
  'locale.zh': '中文',
  'locale.en': 'English',
  'header.search': 'Search agents, chats, workshops, tasks…',
  'header.searchLabel': 'Search',
  'header.noResults': 'No results found',
  'header.docs': 'Documentation',
  'header.skin': 'Open appearance settings',
  'common.cancel': 'Cancel',
  'common.confirm': 'Confirm',
  'common.save': 'Save',
  'common.delete': 'Delete',
  'common.edit': 'Edit',
  'common.loading': 'Loading…',
  'agent.configure': 'Configure Agent',
  'agent.memory': 'Long-term memory',
  'agent.model': 'Model',
  'agent.workspace': 'Workspace',
  'agent.notSelected': 'Not selected',
  'agent.copyWorkspace': '{path} (click to copy)',
  'agent.deleteWarning': 'This clears the workspace and conversation data. Delete this agent?',
  'agent.deleting': 'Deleting…',
  'agent.deleteFailed': 'Unable to delete Agent: {detail}',
  'agent.tabBasic': 'Basic',
  'agent.tabPrompt': 'Prompt',
  'agent.tabTools': 'Tools',
  'agent.tabSkills': 'Skills',
  'agent.avatarLabel': "{name}'s avatar",
  'avatar.preview': 'Pending Agent avatar',
  'avatar.label': 'Avatar',
  'avatar.hint': 'Centered, cropped, and stored as a 256px WebP',
  'avatar.processing': 'Processing…',
  'avatar.change': 'Change image',
  'avatar.select': 'Select image',
  'avatar.remove': 'Remove avatar',
  'permission.label': 'Execution permission',
  'permission.project': 'Project',
  'permission.unrestricted': 'Unrestricted',
  'permission.projectHint': 'File tools can access the 4torm project and current workspace wherever it is located. Other external paths are denied.',
  'permission.unrestrictedHint': 'File tools can access any path. Framework-managed data still requires dedicated tools.',
  'memory.feedback': 'Preference / correction',
  'memory.fact': 'Fact',
  'memory.pitfall': 'Pitfall',
  'memory.reference': 'Reference',
  'memory.required': 'Memory content cannot be empty',
  'memory.prompt': 'What should {agent} remember?',
  'memory.placeholder': 'State exactly what the agent should remember.\nExample: Always save project files atomically by writing a temporary file and renaming it; never use a bare writeFile.',
  'memory.category': 'Category',
  'memory.addTags': '+ Add tags',
  'memory.tagsPlaceholder': 'Comma-separated tags (optional; the system can add them automatically)',
  'memory.hint': 'The system organizes summaries and retrieval tags. Focus on the content itself.',
  'memory.title': '🧠 Long-term memory',
  'memory.subtitle': '{agent} · Experience retained across conversations (view or edit at any time)',
  'memory.close': 'Close long-term memory',
  'memory.add': '+ Add memory manually',
  'memory.empty': 'No memories yet. The agent records them while working, and you can add one manually.',
  'memory.editLabel': 'Edit memory',
  'memory.deleteLabel': 'Delete memory',
  'memory.pending': 'Pending refinement',
  'memory.pendingTitle': 'Summary awaiting Agent refinement',
  'memory.source': 'Source: {source} · Updated {date}',
  'memory.you': 'you',
  'page.agent.title': 'Console',
  'page.agent.subtitle': 'Manage persistent agent instances',
  'page.chat.title': 'Monsoon · Chat',
  'page.chat.subtitle': 'Work directly with an agent',
  'page.tools.title': 'Tools',
  'page.tools.subtitle': 'Register and manage global tools',
  'page.skills.title': 'Skills',
  'page.skills.subtitle': 'Manage reusable agent capabilities',
  'page.convection.title': 'Convection · Meetings',
  'page.convection.subtitle': 'Continuous multi-agent discussion',
  'page.cyclone.title': 'Cyclone · Workshops',
  'page.cyclone.subtitle': 'Seat conversations and team collaboration',
  'page.tradewind.title': 'Tradewind · Workflows',
  'page.tradewind.subtitle': 'Visual multi-agent workflows',
  'page.tide.title': 'Tide · Automation',
  'page.tide.subtitle': 'Wake agents on a schedule',
  'page.model.title': 'Models',
  'page.model.subtitle': 'Model providers and API settings',
  'page.mcp.title': 'MCP',
  'page.mcp.subtitle': 'Manage external tool services',
};

export function normalizeLocale(value: unknown): Locale {
  return value === 'en-US' || value === 'zh-CN' ? value : DEFAULT_LOCALE;
}

export function readStoredLocale(storage: Pick<Storage, 'getItem'>): Locale {
  return normalizeLocale(storage.getItem(LOCALE_STORAGE_KEY));
}

export function writeStoredLocale(storage: Pick<Storage, 'setItem'>, locale: Locale): void {
  storage.setItem(LOCALE_STORAGE_KEY, locale);
}

export type MessageValues = Record<string, string | number>;

const zh = { ...coreZh, ...compactionZh, ...dashboardZh, ...agentConfigZh, ...chatZh, ...taskboardZh, ...chatPageZh, ...convectionZh, ...cycloneZh, ...cycloneSeatZh, ...cycloneShellZh, ...cycloneBulletinZh, ...cycloneRoomZh, ...cycloneSeatChatZh, ...tradewindShellZh, ...tradewindConfigZh, ...tradewindProfileZh, ...tradewindInfoZh, ...tradewindChatZh, ...tradewindMeetingZh, ...tradewindCanvasZh, ...tideZh, ...toolsZh, ...skillsZh, ...mcpZh, ...modelSettingsZh } as const;
const en: Record<keyof typeof zh, string> = { ...coreEn, ...compactionEn, ...dashboardEn, ...agentConfigEn, ...chatEn, ...taskboardEn, ...chatPageEn, ...convectionEn, ...cycloneEn, ...cycloneSeatEn, ...cycloneShellEn, ...cycloneBulletinEn, ...cycloneRoomEn, ...cycloneSeatChatEn, ...tradewindShellEn, ...tradewindConfigEn, ...tradewindProfileEn, ...tradewindInfoEn, ...tradewindChatEn, ...tradewindMeetingEn, ...tradewindCanvasEn, ...tideEn, ...toolsEn, ...skillsEn, ...mcpEn, ...modelSettingsEn };
export type MessageKey = keyof typeof zh;

export function resolveMessage(locale: Locale, key: string, values?: MessageValues): string {
  if (!(key in zh)) return key;
  const message = (locale === 'en-US' ? en[key as MessageKey] : zh[key as MessageKey]) ?? zh[key as MessageKey];
  if (!values) return message;
  return message.replace(/\{(\w+)\}/g, (token, name: string) => (
    Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : token
  ));
}
