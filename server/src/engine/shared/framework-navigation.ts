interface FrameworkReference {
  label: string;
  paths: string[];
  purpose: string;
}

/** Agent 可依赖的项目内稳定入口；详细内容仍按需读取。 */
export const FRAMEWORK_REFERENCES: FrameworkReference[] = [
  { label: '使用与功能区', paths: ['docs/guide/', 'docs/modes/'], purpose: '了解界面、概念和各功能区的公开行为' },
  { label: '架构与数据边界', paths: ['docs/architecture/'], purpose: '确认模块职责、数据归属、安全和桌面运行方式' },
  { label: '扩展指南', paths: ['docs/extend/'], purpose: '制作工具、技能或接入 MCP 前读取对应指南' },
  { label: '框架工具清单', paths: ['server/src/tools/framework/catalog.json'], purpose: '查看随代码发布的只读内置工具定义' },
  { label: '自定义工具', paths: ['data/tools/registry.json', 'data/tools/executors/'], purpose: '查看已注册定义与执行器实现' },
  { label: '技能', paths: ['data/skills/', 'data/skills/{名称}/SKILL.md'], purpose: '查看已安装技能及其按需加载正文' },
  { label: 'MCP', paths: ['data/mcp/servers.json'], purpose: '查看当前服务配置与注入来源' },
];

function renderReference(reference: FrameworkReference): string {
  const paths = reference.paths.map(path => `\`${path}\``).join('、');
  return `- **${reference.label}**：${paths}；${reference.purpose}`;
}

export function buildFrameworkNavigationSection(): string {
  return `## 4torm 框架导航

以下路径相对项目根目录。需要理解框架行为或扩展能力时，先选择对应入口，只读取与当前问题有关的文档；仍需实现细节时，再沿文档进入源码。

${FRAMEWORK_REFERENCES.map(renderReference).join('\n')}

这些路径用于发现事实，不代表写入授权。运行时提供的工具定义与当前代码是最终事实来源；Agent、工具注册表、MCP 配置、潮汐任务和工作流定义等控制面，只能通过对应专用工具或人类界面修改。`;
}
