/** 与内置 run_command 的平台分支一致，不采用登录 shell 或客户端的系统信息。 */
export function buildExecutionEnvironmentSection(platform: NodeJS.Platform = process.platform): string {
  const name = platform === 'win32' ? 'Windows' : platform === 'linux' ? 'Linux'
    : platform === 'darwin' ? 'macOS' : platform;
  const shell = platform === 'win32'
    ? '`cmd.exe`（不是 PowerShell；`;` 不是命令分隔符）'
    : '`/bin/sh`（POSIX sh；不要假定支持 Bash 专属语法）';

  return `## 执行环境（后端宿主）

- 操作系统：${name} (${platform})
- \`run_command\` 的命令解释器：${shell}
- 工具在后端宿主机执行；客户端界面所在的系统不决定命令或路径格式
- 路径与命令采用当前宿主的语法，不能把其他平台的路径或命令原样照搬
- 需要其他解释器时，先确认已安装，再显式调用`;
}
