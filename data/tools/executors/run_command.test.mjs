/**
 * run_command isBlocked 回归测试 —— 用 tsx 跑：
 *   npx tsx data/tools/executors/run_command.test.mjs
 * 重点：/format 不再误伤 URL 里的 format=json；命令长度上限抬到 100000。
 */

import assert from 'node:assert/strict'
import { isBlocked } from './run_command.js'

function run(name, fn) { fn(); console.log(`  ✓ ${name}`) }

console.log('run_command isBlocked')

run('URL 里 format=json 放行（之前误拦的场景）', () => {
  assert.equal(isBlocked('curl "http://localhost:6006/data/plugin/scalars?tag=loss&format=json"'), null)
})

run('真·磁盘格式化 format C: 拦截', () => {
  assert.match(isBlocked('format C:'), /被禁止的操作/)
  assert.match(isBlocked('FORMAT d: /q'), /被禁止的操作/)
})

run('普通长命令（含长 URL）放行，不再撞 1000 线', () => {
  const longUrl = 'curl "http://x/' + 'a'.repeat(3000) + '"'
  assert.equal(isBlocked(longUrl), null)
})

run('病态超长（>100000）仍拦', () => {
  assert.match(isBlocked('echo ' + 'x'.repeat(100001)), /命令过长/)
})

run('其它破坏性命令仍拦', () => {
  assert.match(isBlocked('rm -rf /'), /被禁止的操作/)
  assert.match(isBlocked('shutdown now'), /被禁止的操作/)
  assert.match(isBlocked('mkfs.ext4 /dev/sda'), /被禁止的操作/)
})

run('正常命令放行', () => {
  assert.equal(isBlocked('npm test'), null)
  assert.equal(isBlocked('go build ./...'), null)
})

console.log('ok')
