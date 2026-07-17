import { execSync } from 'child_process'

const BLOCKED_PATTERNS = [
  /rm\s+-rf/i, /rmdir\s+\/s/i, /del\s+\/f/i,
  /shutdown/i, /reboot/i, /halt/i, /poweroff/i,
  // format：仅拦「格式化盘符」如 `format C:`，不误伤 URL 里的 format=json 等
  /mkfs/i, /\bformat\s+[a-z]:/i, /fdisk/i,
  /dd\s+if=/i,
  /curl\s+.*\||wget\s+.*\|/i,
  /:\s*rm\s/, /;\s*rm\s/,
]

// 只留一个"反疯值"上限防止病态超长串；实质不再拦真实命令（长 URL / 内联脚本等）。
const MAX_COMMAND_LENGTH = 100000
const DEFAULT_TIMEOUT = 120000   // 2 分钟：容纳 install / build / test 等正常耗时命令
const MAX_TIMEOUT = 600000       // 上限 10 分钟
const MAX_OUTPUT_CHARS = 30000   // 返回给模型的输出字符上限（头尾保留，掐中间）
const MAX_BUFFER = 10 * 1024 * 1024  // 子进程缓冲 10MB，避免大输出直接 ENOBUFS 抛错

/** 命中破坏性/超长模式返回原因串，否则 null。导出供单测。 */
export function isBlocked(cmd) {
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

function clampOutput(s) {
  if (!s || s.length <= MAX_OUTPUT_CHARS) return s
  const half = Math.floor(MAX_OUTPUT_CHARS / 2)
  return `${s.slice(0, half)}\n\n...[输出过长，省略中间 ${s.length - MAX_OUTPUT_CHARS} 字符]...\n\n${s.slice(-half)}`
}

export default async function (args, ctx) {
  const cmd = args.command || args.cmd || ''
  if (!cmd) throw new Error('缺少 command 参数')

  const blocked = isBlocked(cmd)
  if (blocked) {
    // throw → 调用方标 ok=false（不再假装成功的 ✅）；消息照样透传给模型
    throw new Error(`(安全拦截) ${blocked}`)
  }

  // cwd 起点一律为工作区：命令的相对路径产物落在 agent/工作流各自的 workspace。
  // 若需操作其他目录，用绝对路径或在命令中显式 cd。
  // （注意：shell 内 `cd ..` 仍可越权，本工具只控起点，非硬隔离。）
  const cwd = ctx.workspaceDir || ctx.projectDir
  // 超时可由 agent 传参覆盖（毫秒），夹在 [1s, 10min]
  const timeout = Math.min(MAX_TIMEOUT, Math.max(1000, parseInt(args.timeout, 10) || DEFAULT_TIMEOUT))
  // 前置 chcp 65001 强制 UTF-8，解决 Windows CMD 中文输出乱码
  const wrappedCmd = process.platform === 'win32' ? `chcp 65001 > nul && ${cmd}` : cmd
  try {
    const output = execSync(wrappedCmd, { encoding: 'utf-8', timeout, cwd, maxBuffer: MAX_BUFFER, windowsHide: true })
    return clampOutput(output) || '(命令执行完毕，无输出)'
  } catch (e) {
    if (e.signal === 'SIGTERM' || e.killed) {
      // 超时是真失败 → throw 标 ok=false；消息透传，提示可加大 timeout
      throw new Error(`(命令执行超时 ${timeout}ms，已自动终止；耗时较长的命令可传 timeout 参数加大)`)
    }
    const errOutput = e.stdout || e.stderr || e.message
    const code = typeof e.status === 'number' ? e.status : '未知'
    const body = typeof errOutput === 'string' ? errOutput : String(errOutput)
    return `(命令退出码 ${code})\n${clampOutput(body)}`
  }
}
