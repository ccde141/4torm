import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { atomicWriteFile, drainAtomicWrites } from './atomic-io.js';

test('原子写入完整替换目标文件并清理临时文件', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-atomic-'));
  const filePath = path.join(dir, 'state.json');
  await fs.writeFile(filePath, 'old');

  await atomicWriteFile(filePath, '{"ok":true}');

  assert.equal(await fs.readFile(filePath, 'utf-8'), '{"ok":true}');
  await assert.rejects(fs.access(`${filePath}.tmp`));
});

test('并发写同一目标不会争抢临时文件或留下残留', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-atomic-race-'));
  const filePath = path.join(dir, 'state.json');
  const payloads = Array.from({ length: 20 }, (_, index) => JSON.stringify({ index }));

  await Promise.all(payloads.map(payload => atomicWriteFile(filePath, payload)));

  assert.ok(payloads.includes(await fs.readFile(filePath, 'utf8')));
  const entries = await fs.readdir(dir);
  assert.equal(entries.filter(name => name.endsWith('.tmp')).length, 0);
});

test('排空会等待所有已入队原子写完成', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-atomic-drain-'));
  const first = path.join(dir, 'first.json');
  const second = path.join(dir, 'second.json');
  const writes = [
    atomicWriteFile(first, 'first'),
    atomicWriteFile(second, 'second'),
  ];

  await drainAtomicWrites();

  await Promise.all(writes);
  assert.equal(await fs.readFile(first, 'utf8'), 'first');
  assert.equal(await fs.readFile(second, 'utf8'), 'second');
});

test('临时文件写完后取消不替换原文件，且释放同路径写队列', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-atomic-cancel-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'state.json');
  await fs.writeFile(file, 'original');
  const controller = new AbortController();
  const write = fs.writeFile;
  const mock = t.mock.method(fs, 'writeFile', async (...args: Parameters<typeof fs.writeFile>) => {
    await write(...args);
    if (String(args[0]).startsWith(`${file}.`)) controller.abort(new Error('停止压缩'));
  });
  await assert.rejects(atomicWriteFile(file, 'summary', controller.signal), /停止压缩/);
  assert.equal(await fs.readFile(file, 'utf8'), 'original');
  assert.deepEqual(await fs.readdir(dir), ['state.json']);
  mock.mock.restore();
  await atomicWriteFile(file, 'next');
  assert.equal(await fs.readFile(file, 'utf8'), 'next');
});

test('原子替换已经成功后取消仍按提交成功返回', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-atomic-committed-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'state.json');
  await fs.writeFile(file, 'original');
  const controller = new AbortController();
  const rename = fs.rename;
  t.mock.method(fs, 'rename', async (...args: Parameters<typeof fs.rename>) => {
    await rename(...args);
    if (String(args[1]) === file) controller.abort();
  });
  await atomicWriteFile(file, 'summary', controller.signal);
  assert.equal(controller.signal.aborted, true);
  assert.equal(await fs.readFile(file, 'utf8'), 'summary');
});

for (const code of ['EPERM', 'EBUSY', 'EACCES']) {
  test(`Windows ${code} 短暂占用后只重试同一临时文件，原文件始终完整`, async t => {
    mockPlatform(t, 'win32');
    const { dir, file } = await replacementFixture(t);
    const rename = fs.rename;
    const write = fs.writeFile;
    const sources: string[] = [];
    let writes = 0;
    t.mock.method(fs, 'writeFile', async (...args: Parameters<typeof fs.writeFile>) => {
      if (String(args[0]).startsWith(`${file}.`)) writes++;
      return write(...args);
    });
    t.mock.method(fs, 'rename', async (...args: Parameters<typeof fs.rename>) => {
      if (String(args[1]) === file) {
        sources.push(String(args[0]));
        assert.equal(await fs.readFile(file, 'utf8'), 'original');
        assert.equal(await fs.readFile(args[0], 'utf8'), 'replacement');
        if (sources.length < 3) throw renameError(code);
      }
      return rename(...args);
    });
    await atomicWriteFile(file, 'replacement');
    assert.equal(sources.length, 3);
    assert.equal(new Set(sources).size, 1);
    assert.equal(writes, 1);
    assert.equal(await fs.readFile(file, 'utf8'), 'replacement');
    assert.deepEqual(await fs.readdir(dir), ['state.json']);
  });
}

test('Windows 持久占用在有限次数后报错，保留原文件且清理临时文件', async t => {
  mockPlatform(t, 'win32');
  const { dir, file } = await replacementFixture(t);
  const expected = renameError('EPERM');
  let attempts = 0;
  t.mock.method(fs, 'rename', async () => {
    attempts++;
    assert.equal(await fs.readFile(file, 'utf8'), 'original');
    throw expected;
  });
  await assert.rejects(atomicWriteFile(file, 'replacement'), error => error === expected);
  assert.equal(attempts, 6);
  assert.equal(await fs.readFile(file, 'utf8'), 'original');
  assert.deepEqual(await fs.readdir(dir), ['state.json']);
});

test('Windows 目标是目录时立即报原错误，不把确定性无效目标当作短暂占用', async t => {
  mockPlatform(t, 'win32');
  const { dir, file } = await replacementFixture(t);
  await fs.rm(file);
  await fs.mkdir(file);
  const child = path.join(file, 'preserved.txt');
  await fs.writeFile(child, 'preserved');
  const expected = renameError('EPERM');
  let attempts = 0;
  t.mock.method(fs, 'rename', async () => { attempts++; throw expected; });
  await assert.rejects(atomicWriteFile(file, 'replacement'), error => error === expected);
  assert.equal(attempts, 1);
  assert.equal((await fs.lstat(file)).isDirectory(), true);
  assert.equal(await fs.readFile(child, 'utf8'), 'preserved');
  assert.deepEqual(await fs.readdir(dir), ['state.json']);
});

for (const [platform, code] of [['win32', 'EIO'], ['linux', 'EPERM'], ['darwin', 'EBUSY']] as const) {
  test(`${platform} 的 ${code} 不执行占用重试`, async t => {
    mockPlatform(t, platform);
    const { dir, file } = await replacementFixture(t);
    const expected = renameError(code);
    let attempts = 0;
    t.mock.method(fs, 'rename', async () => { attempts++; throw expected; });
    await assert.rejects(atomicWriteFile(file, 'replacement'), error => error === expected);
    assert.equal(attempts, 1);
    assert.equal(await fs.readFile(file, 'utf8'), 'original');
    assert.deepEqual(await fs.readdir(dir), ['state.json']);
  });
}

test('Windows 占用重试等待期间取消停止提交，后续同路径写入仍可执行', async t => {
  mockPlatform(t, 'win32');
  const { dir, file } = await replacementFixture(t);
  const controller = new AbortController();
  let attempts = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  t.after(() => { if (timer) clearTimeout(timer); });
  const renameMock = t.mock.method(fs, 'rename', async () => {
    attempts++;
    timer = setTimeout(() => controller.abort(new Error('取消占用等待')), 5);
    throw renameError('EBUSY');
  });
  await assert.rejects(atomicWriteFile(file, 'replacement', controller.signal), /取消占用等待/);
  assert.equal(attempts, 1);
  assert.equal(await fs.readFile(file, 'utf8'), 'original');
  assert.deepEqual(await fs.readdir(dir), ['state.json']);
  renameMock.mock.restore();
  await atomicWriteFile(file, 'next');
  assert.equal(await fs.readFile(file, 'utf8'), 'next');
});

function mockPlatform(t: TestContext, platform: NodeJS.Platform): void {
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')!;
  Object.defineProperty(process, 'platform', { configurable: true, get: () => platform });
  t.after(() => Object.defineProperty(process, 'platform', descriptor));
}

async function replacementFixture(t: TestContext): Promise<{ dir: string; file: string }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-atomic-replace-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'state.json');
  await fs.writeFile(file, 'original');
  return { dir, file };
}

function renameError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`rename ${code}`), { code });
}
