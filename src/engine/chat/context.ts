export function buildWorkspaceInfo(workspace: string): string {
  return `\n\n## 环境信息
- 工作区路径: ${workspace}
- read_file / write_file / edit_file / list_directory 默认基于工作区路径
- 若要操作项目级文件（如 data/skills/、data/tools/），可直接传以 data/ 开头的路径，系统会自动定位到项目根目录
- run_command 的当前目录为项目根，所有路径相对于项目根`;
}
