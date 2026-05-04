import { execSync } from 'child_process'

const BLOCKED_PATTERNS = [
  /rm\s+-rf/i, /rmdir\s+\/s/i, /del\s+\/f/i,
  /shutdown/i, /reboot/i, /halt/i, /poweroff/i,
  /mkfs/i, /format/i, /fdisk/i,
  /dd\s+if=/i,
  /curl\s+.*\||wget\s+.*\|/i,
  /:\s*rm\s/, /;\s*rm\s/,
]

const MAX_COMMAND_LENGTH = 1000
const CMD_TIMEOUT = 15000

function isBlocked(cmd) {
  if (cmd.length > MAX_COMMAND_LENGTH) {
    return `命令过长 (${cmd.length} > ${MAX_COMMAND_LENGTH} 字符)`
  }
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(cmd)) {
      return `命令包含被禁止的操作: ${pattern}`
    }
  }
  return null
}

export default async function (args, ctx) {
  const cmd = args.command || args.cmd || ''
  if (!cmd) throw new Error('缺少 command 参数')

  const blocked = isBlocked(cmd)
  if (blocked) {
    return `(安全拦截) ${blocked}`
  }

  const cwd = ctx.projectDir || ctx.workspaceDir
  // 前置 chcp 65001 强制 UTF-8，解决 Windows CMD 中文输出乱码
  const wrappedCmd = process.platform === 'win32' ? `chcp 65001 > nul && ${cmd}` : cmd
  try {
    const output = execSync(wrappedCmd, { encoding: 'utf-8', timeout: CMD_TIMEOUT, cwd, maxBuffer: 1024 * 1024, windowsHide: true })
    return output || '(命令执行完毕，无输出)'
  } catch (e) {
    if (e.signal === 'SIGTERM' || e.killed) {
      return '(命令执行超时，已自动终止)'
    }
    const errOutput = e.stdout || e.stderr || e.message
    return typeof errOutput === 'string' ? errOutput : String(errOutput)
  }
}
