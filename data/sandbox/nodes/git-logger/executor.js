import { execSync } from 'child_process'

export default async function (args, ctx) {
  const repoPath = args.repoPath || ctx.workspaceDir
  const max = parseInt(args.maxCommits) || 10
  try {
    const log = execSync(`git -C "${repoPath}" log --oneline -${max}`, {
      encoding: 'utf-8',
      timeout: 10000,
      cwd: repoPath,
    })
    return log || '(无提交记录)'
  } catch (e) {
    return `Git 日志获取失败: ${e.message}`
  }
}
