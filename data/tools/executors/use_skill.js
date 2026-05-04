import { readFileSync } from 'fs'
import { resolve } from 'path'

export default async function (args, ctx) {
  const skillName = args.skill
  if (!skillName) throw new Error('缺少 skill 参数')
  const skillPath = resolve(ctx.dataDir, 'skills', skillName, 'SKILL.md')
  try {
    return readFileSync(skillPath, 'utf-8')
  } catch {
    throw new Error(`技能 "${skillName}" 不存在或无法读取。请确认技能名称正确。可用技能可通过 Agent 配置中的技能列表查看。`)
  }
}
