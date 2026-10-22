import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { installGuideSkill } from './install-guide-skill.mjs';

const script = fileURLToPath(new URL('./install-guide-skill.mjs', import.meta.url));

async function fixture(t, content = '# Desktop guidance\n\nUse the configured MCP tools.\n') {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), '4torm-guide-import-'));
  const source = path.join(directory, 'Vision Desktop');
  const dataDir = path.join(directory, 'data');
  await fs.mkdir(source);
  await fs.mkdir(dataDir);
  await fs.writeFile(path.join(source, 'SKILL.md'), content);
  t.after(async () => {
    if (!path.basename(directory).startsWith('4torm-guide-import-') || path.dirname(directory) !== os.tmpdir()) {
      throw new Error('Refused fixture cleanup outside its temporary directory');
    }
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  });
  return { directory, source, dataDir };
}

test('CLI 帮助和参数错误不写入文件', () => {
  const help = spawnSync(process.execPath, [script, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /skill:install/);
  assert.match(help.stdout, /does not run scripts/);
  const invalid = spawnSync(process.execPath, [script, '--source', 'missing'], { encoding: 'utf8' });
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /Both --source and --data-dir are required/);
});

test('CLI 安装纯指南，保留原文并生成元数据，不改变 Agent 或 MCP 配置', async t => {
  const original = '\uFEFF---\r\nname: "Desktop Guide"\r\ndescription: A host neutral guide\r\n---\r\n# Usage\r\nUse MCP.\r\n';
  const f = await fixture(t, original);
  const settings = { agents: 'keep agents', mcp: 'keep mcp' };
  for (const [name, value] of Object.entries(settings)) await fs.writeFile(path.join(f.dataDir, `${name}.json`), value);
  await fs.writeFile(path.join(f.source, 'config.json'), '{"unreviewed":"metadata"}');
  const run = spawnSync(process.execPath, [script, '--source', path.join(f.source, 'SKILL.md'), '--data-dir', f.dataDir], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const result = JSON.parse(run.stdout);
  assert.equal(result.skillId, 'vision-desktop');
  assert.deepEqual(await fs.readFile(path.join(result.directory, 'SKILL.md')), Buffer.from(original));
  const metadata = JSON.parse(await fs.readFile(path.join(result.directory, 'config.json'), 'utf8'));
  assert.equal(metadata.name, 'Desktop Guide');
  assert.equal(metadata.description, 'A host neutral guide');
  assert.equal(metadata.unreviewed, undefined);
  for (const [name, value] of Object.entries(settings)) assert.equal(await fs.readFile(path.join(f.dataDir, `${name}.json`), 'utf8'), value);
  assert.deepEqual(await fs.readdir(path.join(f.dataDir, 'skills')), ['vision-desktop']);
});

test('只复制被 Markdown 相对链接引用的静态文件和递归文档，不扫描无关文件', async t => {
  const f = await fixture(t, '# Guide\n[More](references/next.md)\n[Remote](https://example.test/no-download)\n');
  await fs.mkdir(path.join(f.source, 'references'));
  await fs.writeFile(path.join(f.source, 'references', 'next.md'), '# Next\n![image](../assets/image.png)\n[Top](../SKILL.md#guide)\n');
  await fs.mkdir(path.join(f.source, 'assets'));
  await fs.writeFile(path.join(f.source, 'assets', 'image.png'), Buffer.from([0, 1, 2]));
  await fs.writeFile(path.join(f.source, 'unreferenced-secret.txt'), 'not copied');
  const result = await installGuideSkill(f);
  assert.deepEqual(result.files.sort(), ['SKILL.md', 'config.json', path.join('references', 'next.md'), path.join('assets', 'image.png')].sort());
  assert.deepEqual(await fs.readFile(path.join(result.directory, 'assets', 'image.png')), Buffer.from([0, 1, 2]));
  await assert.rejects(fs.stat(path.join(result.directory, 'unreferenced-secret.txt')), { code: 'ENOENT' });
});

test('拒绝覆盖既有技能且保留原内容，无安装中间目录遗留', async t => {
  const f = await fixture(t);
  const first = await installGuideSkill(f);
  await fs.writeFile(path.join(first.directory, 'keep.txt'), 'previous data');
  await assert.rejects(installGuideSkill(f), /Skill already exists/);
  assert.equal(await fs.readFile(path.join(first.directory, 'keep.txt'), 'utf8'), 'previous data');
  assert.deepEqual(await fs.readdir(path.join(f.dataDir, 'skills')), ['vision-desktop']);
});

test('拒绝可执行工具声明、脚本引用和目录外读取，不发布半成品', async t => {
  for (const declaration of ['tools.json', 'executors']) {
    const f = await fixture(t);
    await fs.writeFile(path.join(f.source, declaration), '{}');
    await assert.rejects(installGuideSkill(f), /Guide-only import/);
    assert.deepEqual(await fs.readdir(f.dataDir), []);
  }
  for (const reference of ['../outside.txt', '%2e%2e/outside.txt', 'run.py', '/absolute.txt', 'file:///private.txt']) {
    const f = await fixture(t, `[Read](${reference})\n`);
    await fs.writeFile(path.join(f.directory, 'outside.txt'), 'private');
    await fs.writeFile(path.join(f.source, 'run.py'), 'raise Exception("must not run")');
    await assert.rejects(installGuideSkill(f), /leaves the skill|Only guide|Invalid local|Absolute file/);
    assert.deepEqual(await fs.readdir(f.dataDir), []);
  }
});

test('拒绝源目录和目标目录中的链接，不访问链接目标', async t => {
  const f = await fixture(t, '[Read](linked/private.md)\n');
  const outside = path.join(f.directory, 'outside');
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, 'private.md'), 'outside contents');
  try { await fs.symlink(outside, path.join(f.source, 'linked'), process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (error.code === 'EPERM') { t.skip('Symbolic links are unavailable'); return; } throw error; }
  await assert.rejects(installGuideSkill(f), /Symbolic links/);
  assert.deepEqual(await fs.readdir(f.dataDir), []);
  await fs.symlink(outside, path.join(f.dataDir, 'skills'), process.platform === 'win32' ? 'junction' : 'dir');
  await fs.writeFile(path.join(f.source, 'SKILL.md'), '# Guide');
  await assert.rejects(installGuideSkill(f), /Symbolic links/);
  assert.deepEqual(await fs.readdir(outside), ['private.md']);
});

test('同一技能并发安装只有一个成功，已有安装锁不会被清除', async t => {
  const f = await fixture(t);
  const outcomes = await Promise.allSettled([installGuideSkill(f), installGuideSkill(f)]);
  assert.equal(outcomes.filter(item => item.status === 'fulfilled').length, 1);
  assert.deepEqual(await fs.readdir(path.join(f.dataDir, 'skills')), ['vision-desktop']);
  const second = await fixture(t);
  await fs.mkdir(path.join(second.dataDir, 'skills'));
  const lock = path.join(second.dataDir, 'skills', '.install-vision-desktop.lock');
  await fs.writeFile(lock, 'someone else');
  await assert.rejects(installGuideSkill(second), { code: 'EEXIST' });
  assert.equal(await fs.readFile(lock, 'utf8'), 'someone else');
});

test('非英文目录生成合法且稳定的技能 ID', async t => {
  const f = await fixture(t);
  const source = path.join(f.directory, '桌面指南');
  await fs.rename(f.source, source);
  const result = await installGuideSkill({ ...f, source });
  assert.match(result.skillId, /^skill-[a-f0-9]{12}$/);
});

test('发布失败只清理本轮阶段目录，不清除其他目录或锁', async t => {
  const f = await fixture(t);
  const skills = path.join(f.dataDir, 'skills');
  await fs.mkdir(path.join(skills, '.install-unrelated'), { recursive: true });
  await fs.writeFile(path.join(skills, '.install-unrelated', 'keep.txt'), 'keep');
  t.mock.method(fs, 'rename', async () => { throw new Error('simulated publish failure'); });
  await assert.rejects(installGuideSkill(f), /simulated publish failure/);
  assert.deepEqual(await fs.readdir(skills), ['.install-unrelated']);
  assert.equal(await fs.readFile(path.join(skills, '.install-unrelated', 'keep.txt'), 'utf8'), 'keep');
});
