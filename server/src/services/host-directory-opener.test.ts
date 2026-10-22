import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { openHostDirectory } from './host-directory-opener.js';

test('宿主目录打开程序缺失时，对流必须拒绝而不是返回已打开', async t => {
  const fixture = await mkdtemp(path.join(tmpdir(), '4torm-host-directory-'));
  t.after(() => rm(fixture, { recursive: true, force: true }));
  const source = new URL('../modules/convection/runtime/workspace-opener.ts', import.meta.url).href;
  const childFile = path.join(fixture, 'probe.mts');
  await writeFile(childFile, `
    import childProcess from 'node:child_process';
    import { syncBuiltinESMExports } from 'node:module';
    const originalSpawn = childProcess.spawn;
    childProcess.spawn = (_command, args, options) =>
      originalSpawn(${JSON.stringify(path.join(fixture, 'missing-opener'))}, args, options);
    syncBuiltinESMExports();
    const { ConvectionWorkspaceOpener } = await import(${JSON.stringify(source)});
    try {
      await new ConvectionWorkspaceOpener(${JSON.stringify(fixture)}).open('conv-test');
      console.log(JSON.stringify({ opened: true }));
    } catch (error) {
      console.log(JSON.stringify({ opened: false, errorCode: error.data?.code,
        causeCode: error.cause?.code }));
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  `);
  const result = await runProbe(childFile);
  assert.equal(result.code, 0, result.stderr);
  const observed = JSON.parse(result.stdout.trim());
  assert.equal(observed.opened, false);
  assert.equal(observed.errorCode, 'HOST_DIRECTORY_OPEN_FAILED');
  assert.equal(observed.causeCode, 'ENOENT');
});

test('宿主目录打开保持各平台启动契约，目录作为单独参数原样传递', async () => {
  const directory = path.join(tmpdir(), 'a directory with spaces');
  let invoked = false;
  await openHostDirectory(directory, (command, args, options) => {
    invoked = true;
    const expected = process.platform === 'win32' ? 'explorer.exe'
      : process.platform === 'darwin' ? 'open' : 'xdg-open';
    assert.equal(command, expected);
    assert.deepEqual(args, [directory]);
    assert.equal(options.detached, true);
    assert.equal(options.stdio, 'ignore');
    // 启动短暂 Node 子进程作为系统程序受理的对照，不启动真实文件管理器。
    return spawn(process.execPath, ['-e', 'setTimeout(() => {}, 100)'], options);
  });
  assert.equal(invoked, true);
});

function runProbe(file: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', import.meta.resolve('tsx'), file]);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', code => resolve({ code, stdout, stderr }));
  });
}
