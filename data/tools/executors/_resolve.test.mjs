/**
 * 控制面写保护回归测试 —— 用 tsx 跑：
 *   npx tsx data/tools/executors/_resolve.test.mjs
 *
 * 核心：{wfId}/workspace/** 是 agent 工作区，写操作必须放行；
 *       同级的 graph.json / meta.json 等控制文件、以及 tide/registry 仍须拦。
 */

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, symlinkSync } from 'node:fs'
import os from 'node:os'
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
  for (const sandboxLevel of ['project', 'unrestricted']) {
    assert.throws(() => resolvePath(abs('tide/tasks.json'), { ...ctx, sandboxLevel }, { write: true }), /框架控制文件/)
    assert.throws(() => resolvePath(abs('agents/registry.json'), { ...ctx, sandboxLevel }, { write: true }), /框架控制文件/)
  }
})

run('读操作不受控制面限制（graph.json 可读）', () => {
  resolvePath(abs('tradewind/workflows', wfId, 'graph.json'), ctx) // 无 write → 不校验控制面
})

run('项目级允许当前工作区，旧权限值仍按项目级兼容', () => {
  for (const sandboxLevel of ['project', 'strict', 'relaxed']) {
    const resolved = resolvePath('note.txt', { ...ctx, sandboxLevel }, { write: true })
    assert.ok(resolved.endsWith(path.join('workspace', 'note.txt')))
  }
})

run('项目级拒绝未配置的外部绝对路径', () => {
  const expected = path.resolve(ctx.projectDir, '..', 'outside.txt')
  assert.throws(
    () => resolvePath(expected, { ...ctx, sandboxLevel: 'project' }),
    /工作区或项目目录/
  )
  assert.throws(
    () => resolvePath(expected, { ...ctx, sandboxLevel: 'project' }, { write: true }),
    /工作区或项目目录/
  )
})

run('项目级允许显式配置在项目外的工作区', () => {
  const externalWorkspace = path.resolve(dataDir, '..', '..', 'configured-workspace')
  const externalCtx = { ...ctx, workspaceDir: externalWorkspace, sandboxLevel: 'project' }
  assert.equal(resolvePath('output.txt', externalCtx, { write: true }), path.join(externalWorkspace, 'output.txt'))
})

run('项目级允许其他 Agent 的 memory 文件', () => {
  const memory = abs('agents', 'other-agent', 'memory', 'note.md')
  assert.equal(resolvePath(memory, { ...ctx, sandboxLevel: 'project' }, { write: true }), memory)
})

run('无限制允许未配置的外部绝对路径', () => {
  const outside = path.resolve(dataDir, '..', '..', 'outside.txt')
  assert.equal(resolvePath(outside, { ...ctx, sandboxLevel: 'unrestricted' }, { write: true }), outside)
})

run('符号链接不能把项目级写入带到外部目录', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), '4torm-resolve-'))
  const realProject = path.join(root, 'project')
  const realWorkspace = path.join(realProject, 'workspace')
  const outside = path.join(root, 'outside')
  mkdirSync(realWorkspace, { recursive: true })
  mkdirSync(outside, { recursive: true })
  symlinkSync(outside, path.join(realWorkspace, 'linked'), 'junction')
  const realCtx = { projectDir: realProject, workspaceDir: realWorkspace, sandboxLevel: 'project' }
  assert.throws(() => resolvePath('linked/file.txt', realCtx, { write: true }), /工作区或项目目录/)
})

run('符号链接不能绕过控制面写保护', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), '4torm-control-link-'))
  const realData = path.join(root, 'data')
  const realWorkspace = path.join(root, 'workspace')
  const agentsDir = path.join(realData, 'agents')
  mkdirSync(realWorkspace, { recursive: true })
  mkdirSync(agentsDir, { recursive: true })
  symlinkSync(agentsDir, path.join(realWorkspace, 'agents-link'), 'junction')
  const realCtx = {
    dataDir: realData,
    projectDir: root,
    workspaceDir: realWorkspace,
    sandboxLevel: 'unrestricted',
  }
  assert.throws(() => resolvePath('agents-link/registry.json', realCtx, { write: true }), /框架控制文件/)
})

run('指向尚不存在外部文件的符号链接仍按真实目标拦截', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), '4torm-broken-link-'))
  const realProject = path.join(root, 'project')
  const realWorkspace = path.join(realProject, 'workspace')
  const outsideDir = path.join(root, 'outside')
  mkdirSync(realWorkspace, { recursive: true })
  mkdirSync(outsideDir, { recursive: true })
  symlinkSync(path.join(outsideDir, 'future.txt'), path.join(realWorkspace, 'future.txt'), 'file')
  const realCtx = { projectDir: realProject, workspaceDir: realWorkspace, sandboxLevel: 'project' }
  assert.throws(() => resolvePath('future.txt', realCtx, { write: true }), /工作区或项目目录/)
})

run('data/ 相对路径仍基于 workspace，不再切换到项目根', () => {
  const r = resolvePath('data/notes.txt', { ...ctx, sandboxLevel: 'relaxed' })
  assert.equal(r, path.resolve(workspaceDir, 'data/notes.txt'))
})

console.log('ok')
