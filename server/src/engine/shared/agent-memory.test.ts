/**
 * agent-memory 单元测试 —— 直接用 tsx 跑（本仓库暂无 vitest runner）：
 *   cd server && npx tsx src/engine/shared/agent-memory.test.ts
 * 断言失败即抛错、进程非零退出；全绿打印 ok。
 *
 * 用真实临时目录做 IO，验证"写→索引→召回"整条链路。
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { writeMemory, listMemory, readMemory, recallMemory } from './agent-memory';

const AID = 'agent-test';
const NOW = '2026-07-12T14:30:00+08:00';

async function tmpData(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'memtest-'));
}

async function run(name: string, fn: () => Promise<void>) {
  await fn();
  console.log(`  ✓ ${name}`);
}

async function main() {
  console.log('agent-memory');

  await run('写：落条目文件 + 更新 index，slug 由 summary 生成', async () => {
    const dir = await tmpData();
    const { slug } = await writeMemory(dir, AID, {
      summary: 'atomic writes required', detail: '全项目文件写入必须原子',
      category: 'feedback', tags: ['写入', '数据安全'], source: 'tradewind', now: NOW,
    });
    assert.equal(slug, 'atomic-writes-required');
    const entry = await readMemory(dir, AID, slug);
    assert.equal(entry?.summary, 'atomic writes required');
    assert.equal(entry?.category, 'feedback');
    assert.deepEqual(entry?.tags, ['写入', '数据安全']);
    assert.equal(entry?.created, NOW);
    const idx = await listMemory(dir, AID);
    assert.equal(idx.length, 1);
    assert.equal(idx[0].slug, slug);
  });

  await run('写：同摘要 slug 冲突自动 -2 递增', async () => {
    const dir = await tmpData();
    const a = await writeMemory(dir, AID, { summary: '重复标题', detail: 'x', category: 'fact', source: 's', now: NOW });
    const b = await writeMemory(dir, AID, { summary: '重复标题', detail: 'y', category: 'fact', source: 's', now: NOW });
    assert.notEqual(a.slug, b.slug);
    assert.equal(b.slug, `${a.slug}-2`);
    assert.equal((await listMemory(dir, AID)).length, 2);
  });

  await run('召回：feedback 常驻档无 hint 也必带（至少召回一次）', async () => {
    const dir = await tmpData();
    await writeMemory(dir, AID, { summary: '用户偏好原子写', detail: '硬偏好', category: 'feedback', source: 's', now: NOW });
    const seg = await recallMemory(dir, AID); // 不给 taskHint
    assert.match(seg, /你的经验记忆/);
    assert.match(seg, /硬偏好/);
  });

  await run('召回：情境档按 taskHint 词重叠命中', async () => {
    const dir = await tmpData();
    await writeMemory(dir, AID, { summary: 'PDF 解析踩坑', detail: 'pdf 用 xxx 库', category: 'pitfall', tags: ['pdf', '解析'], source: 's', now: NOW });
    await writeMemory(dir, AID, { summary: '无关记忆', detail: '不该出现', category: 'fact', tags: ['音频'], source: 's', now: NOW });
    const hit = await recallMemory(dir, AID, '帮我做一个 pdf 解析');
    assert.match(hit, /pdf 用 xxx 库/);
    assert.doesNotMatch(hit, /不该出现/);
  });

  await run('召回：空库返回空串', async () => {
    const dir = await tmpData();
    assert.equal(await recallMemory(dir, AID, '任意'), '');
  });

  await run('索引：summary 含分隔符 | 不破坏解析', async () => {
    const dir = await tmpData();
    await writeMemory(dir, AID, { summary: 'a | b | c', detail: 'd', category: 'fact', source: 's', now: NOW });
    const idx = await listMemory(dir, AID);
    assert.equal(idx.length, 1);
    assert.equal(idx[0].summary, 'a ／ b ／ c');
  });

  console.log('ok');
}

main().catch(e => { console.error(e); process.exit(1); });
