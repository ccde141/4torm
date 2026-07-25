/**
 * run_command isBlocked 回归测试 —— 用 tsx 跑：
 *   npx tsx data/tools/executors/run_command.test.mjs
 * 重点：/format 不再误伤 URL 里的 format=json；命令长度上限抬到 100000。
 */

import assert from 'node:assert/strict'
import { isBlocked, runCommand } from './run_command.js'

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

await runAsync('长命令不阻塞事件循环，并可由 AbortSignal 中止', async () => {
  const controller = new AbortController()
  const executable = JSON.stringify(process.execPath)
  const pending = runCommand(`${executable} -e "setTimeout(() => {}, 10000)"`, {
    cwd: process.cwd(),
    timeout: 30_000,
    signal: controller.signal,
  })

  await new Promise(resolve => setImmediate(resolve))
  controller.abort()
  await assert.rejects(pending, error => error?.name === 'AbortError' && /已中止/.test(error.message))
})

await runAsync('超时与非零退出都真实抛错', async () => {
  const executable = JSON.stringify(process.execPath)
  await assert.rejects(
    runCommand(`${executable} -e "setTimeout(() => {}, 10000)"`, {
      cwd: process.cwd(), timeout: 50,
    }),
    /执行超时 50ms/,
  )
  await assert.rejects(
    runCommand(`${executable} -e "process.exit(7)"`, {
      cwd: process.cwd(), timeout: 5_000,
    }),
    /退出码 7/,
  )
})

await runAsync('Windows shell 将中文路径原样传给子进程', async () => {
  const executable = JSON.stringify(process.execPath)
  const expected = String.raw`G:\思考的快与慢\第一部分\文稿初版.docx`
  const output = await runCommand(`${executable} -e "process.stdout.write(process.argv[1])" "${expected}"`, {
    cwd: process.cwd(), timeout: 5_000,
  })
  assert.equal(output, expected)
})

await runAsync('子进程统一继承 Python UTF-8 输出环境', async () => {
  const executable = JSON.stringify(process.execPath)
  const script = "process.stdout.write([process.env.PYTHONUTF8,process.env.PYTHONIOENCODING].join('|'))"
  const output = await runCommand(`${executable} -e "${script}"`, {
    cwd: process.cwd(), timeout: 5_000,
  })
  assert.equal(output, '1|utf-8')
})

await runAsync('失败时同时保留 stdout 与 stderr 并清理终端颜色码', async () => {
  const executable = JSON.stringify(process.execPath)
  const script = "process.stdout.write('FIRST\\n');process.stderr.write('\\u001b[31mFINAL\\u001b[0m');process.exit(9)"
  await assert.rejects(
    runCommand(`${executable} -e "${script}"`, { cwd: process.cwd(), timeout: 5_000 }),
    error => /FIRST/.test(error.message)
      && /FINAL/.test(error.message)
      && !error.message.includes('\u001b['),
  )
})

console.log('ok')

async function runAsync(name, fn) {
  await fn()
  console.log(`  ✓ ${name}`)
}
