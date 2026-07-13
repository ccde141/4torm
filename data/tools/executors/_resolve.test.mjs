/**
 * 控制面写保护回归测试 —— 用 tsx 跑：
 *   npx tsx data/tools/executors/_resolve.test.mjs
 *
 * 核心：{wfId}/workspace/** 是 agent 工作区，写操作必须放行；
 *       同级的 graph.json / meta.json 等控制文件、以及 tide/registry 仍须拦。
 */

import assert from 'node:assert/strict'
import path from 'node:path'
import { resolvePath } from './_resolve.js'

const dataDir = path.resolve('/srv/app/data')
const wfId = 'wf-rkkadb2heo'
const workspaceDir = path.join(dataDir, 'tradewind/workflows', wfId, 'workspace')
const ctx = { dataDir, workspaceDir, projectDir: path.dirname(dataDir), sandboxLevel: 'unrestricted' }
const abs = (...p) => path.join(dataDir, ...p)

function run(name, fn) { fn(); console.log(`  ✓ ${name}`) }

console.log('控制面写保护')

run('workspace 内写：放行（就是它之前误拦的场景）', () => {
  const r = resolvePath('requirements-specification.md', ctx, { write: true })
  assert.ok(r.endsWith(path.join('workspace', 'requirements-specification.md')))
})

run('workspace 深层子目录写：放行', () => {
  resolvePath('sub/dir/out.md', ctx, { write: true })
})

run('工作流控制文件 graph.json：拦', () => {
  assert.throws(
    () => resolvePath(abs('tradewind/workflows', wfId, 'graph.json'), ctx, { write: true }),
    /框架控制文件/,
  )
})

run('工作流控制文件 meta.json：拦', () => {
  assert.throws(
    () => resolvePath(abs('tradewind/workflows', wfId, 'meta.json'), ctx, { write: true }),
    /框架控制文件/,
  )
})

run('潮汐任务 / 注册表：拦', () => {
  assert.throws(() => resolvePath(abs('tide/tasks.json'), ctx, { write: true }), /框架控制文件/)
  assert.throws(() => resolvePath(abs('agents/registry.json'), ctx, { write: true }), /框架控制文件/)
})

run('读操作不受控制面限制（graph.json 可读）', () => {
  resolvePath(abs('tradewind/workflows', wfId, 'graph.json'), ctx) // 无 write → 不校验控制面
})

// relaxed 沙箱：写只能落 workspace，读可及项目根（贯彻"以工作区为基准"）
const relaxedCtx = { ...ctx, sandboxLevel: 'relaxed' }

run('relaxed 写到项目根（../../foo.txt）：拦', () => {
  assert.throws(
    () => resolvePath('../../../../foo.txt', relaxedCtx, { write: true }),
    /路径越权/,
  )
})

run('relaxed 相对写：落在 workspace 内', () => {
  const r = resolvePath('note.txt', relaxedCtx, { write: true })
  assert.ok(r.endsWith(path.join('workspace', 'note.txt')))
})

run('relaxed 读 data/ 下文件：放行（读项目源码）', () => {
  const r = resolvePath('data/agents/registry.json', relaxedCtx)
  assert.ok(r.includes('registry.json'))
})

console.log('ok')
