import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const bilingualPages = [
  'index.md',
  'guide/introduction.md',
  'guide/getting-started.md',
  'guide/concepts.md',
  'guide/agents.md',
  'guide/providers.md',
  'guide/troubleshooting.md',
  'modes/chat.md',
  'modes/convection.md',
  'modes/cyclone.md',
  'modes/tradewind.md',
  'modes/tide.md',
  'extend/tools.md',
  'extend/skills.md',
  'extend/mcp.md',
  'architecture/overview.md',
  'architecture/data-layout.md',
  'architecture/security.md',
  'architecture/desktop.md',
] as const;

async function read(relativePath: string, english = false): Promise<string> {
  const prefix = english ? '../docs/en/' : '../docs/';
  return fs.readFile(new URL(`${prefix}${relativePath}`, import.meta.url), 'utf8');
}

function headingLevels(markdown: string): number[] {
  let inFence = false;
  const levels: number[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = /^(#{1,3})\s+/.exec(line);
    if (match) levels.push(match[1].length);
  }
  return levels;
}

test('every public page has an English counterpart with the same section structure', async () => {
  for (const page of bilingualPages) {
    const [chinese, english] = await Promise.all([read(page), read(page, true)]);
    assert.deepEqual(headingLevels(english), headingLevels(chinese), page);
  }
});

test('quick start documents the in-app language switch in both languages', async () => {
  const [chinese, english] = await Promise.all([
    read('guide/getting-started.md'),
    read('guide/getting-started.md', true),
  ]);

  assert.match(chinese, /侧栏左下角.*中文.*English/s);
  assert.match(chinese, /记住.*选择/);
  assert.match(english, /bottom-left.*Chinese.*English/is);
  assert.match(english, /remember.*selection/is);
});

test('agent guide documents avatar behavior and its display boundary', async () => {
  const [chinese, english] = await Promise.all([
    read('guide/agents.md'),
    read('guide/agents.md', true),
  ]);

  assert.match(chinese, /头像.*20 MB.*256px WebP/s);
  assert.match(chinese, /控制台、季风和对流/);
  assert.match(chinese, /气旋、信风和潮汐.*首字母/);
  assert.match(english, /avatar.*20 MB.*256px WebP/is);
  assert.match(english, /Console, Monsoon, and Convection/);
  assert.match(english, /Cyclone, Tradewind, and Tide.*initials/is);
});

test('data layout includes the persisted agent avatar in both languages', async () => {
  const [chinese, english] = await Promise.all([
    read('architecture/data-layout.md'),
    read('architecture/data-layout.md', true),
  ]);

  for (const document of [chinese, english]) {
    assert.match(document, /profile\/[\s\S]*avatar\.webp/);
  }
  assert.match(chinese, /Agent 头像/);
  assert.match(english, /agent avatar/i);
});

test('data layout omits supplementary implementation and repository details', async () => {
  const [chinese, english] = await Promise.all([
    read('architecture/data-layout.md'),
    read('architecture/data-layout.md', true),
  ]);

  assert.doesNotMatch(chinese, /^## Git 跟踪边界$/m);
  assert.doesNotMatch(chinese, /^## 写入与恢复$/m);
  assert.doesNotMatch(chinese, /^## 不写入文件的状态$/m);
  assert.doesNotMatch(chinese, /Agent 头像保存在/);
  assert.doesNotMatch(chinese, /新建 Agent 时.*MEMORY\.md/);
  assert.doesNotMatch(english, /^## Git Tracking Boundary$/m);
  assert.doesNotMatch(english, /^## Writes and Recovery$/m);
  assert.doesNotMatch(english, /^## Process-Only State$/m);
  assert.doesNotMatch(english, /The agent avatar is stored at/);
  assert.doesNotMatch(english, /New agents may still receive.*MEMORY\.md/);
});

test('user guides do not expose provider qualification notes', async () => {
  const files = [
    'guide/getting-started.md',
    'guide/providers.md',
    'guide/troubleshooting.md',
  ];
  for (const page of files) {
    for (const document of [await read(page), await read(page, true)]) {
      assert.doesNotMatch(document, /资格测试|自动化契约|付费验收|qualification|automated contracts|paid live API/i, page);
    }
  }

  const [readme, chineseReadme] = await Promise.all([
    fs.readFile(new URL('../README.md', import.meta.url), 'utf8'),
    fs.readFile(new URL('../README.zh-CN.md', import.meta.url), 'utf8'),
  ]);
  for (const document of [readme, chineseReadme]) {
    assert.doesNotMatch(document, /已适配云服务|qualified cloud services/i);
  }
});
