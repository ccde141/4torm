/**
 * salvageToolArgs 单测 —— 用 tsx 跑：
 *   cd server && npx tsx src/engine/shared/tool-bridge.salvage.test.ts
 *
 * 覆盖本地模型（7B~35B）常见脏 arguments：干净 / fence 包裹 / 前后垃圾 /
 * 尾逗号 / Windows 路径反斜杠（复现云端也踩过的 \A 坑）/ 非对象 / 空。
 */

import assert from 'node:assert/strict';
import { salvageToolArgs } from './tool-bridge';

let pass = 0;
function ok(name: string, cond: boolean) {
  assert.ok(cond, `FAIL: ${name}`);
  pass++;
}

// 1. 干净 JSON → repaired=false
{
  const r = salvageToolArgs('{"path":"a.txt","content":"hi"}');
  ok('clean-parse', r.ok && !r.repaired && r.args.path === 'a.txt');
}

// 2. 空/空白 → 空对象
{
  const r = salvageToolArgs('   ');
  ok('empty', r.ok && Object.keys(r.args).length === 0);
}

// 3. markdown fence 包裹 → 剥后救回
{
  const r = salvageToolArgs('```json\n{"cmd":"ls -la"}\n```');
  ok('fence', r.ok && r.repaired && r.args.cmd === 'ls -la');
}

// 4. 前缀垃圾（functions.write 混入）→ 抠配平救回
{
  const r = salvageToolArgs('functions.write {"path":"x.md"}');
  ok('leading-garbage', r.ok && r.repaired && r.args.path === 'x.md');
}

// 5. 尾逗号 → 轻量语法修
{
  const r = salvageToolArgs('{"a":"1","b":"2",}');
  ok('trailing-comma', r.ok && r.repaired && r.args.b === '2');
}

// 6. Windows 路径反斜杠在字符串内 → 配平扫描不被干扰（\A 坑）
{
  const r = salvageToolArgs('{"path":"I:\\\\A_Test\\\\providers.json"}');
  ok('windows-path', r.ok && r.args.path.includes('A_Test'));
}

// 7. 后缀垃圾一个点 → 救回
{
  const r = salvageToolArgs('{"q":"hi"} .');
  ok('trailing-dot', r.ok && r.repaired && r.args.q === 'hi');
}

// 8. 数组（非对象）→ 救不回（不能当参数）
{
  const r = salvageToolArgs('[1,2,3]');
  ok('array-reject', !r.ok);
}

// 9. 纯垃圾 → 救不回
{
  const r = salvageToolArgs('这不是 JSON 只是模型在说话');
  ok('garbage-reject', !r.ok);
}

// 10. 嵌套对象值被 stringify 成字符串（保持 Record<string,string> 约定）
{
  const r = salvageToolArgs('{"opts":{"n":1}}');
  ok('nested-stringify', r.ok && r.args.opts === '{"n":1}');
}

// 11. 前缀超长（>96 字符）→ 拒绝（防把正文当参数）
{
  const longLead = 'x'.repeat(200);
  const r = salvageToolArgs(`${longLead} {"a":"1"}`);
  ok('long-leading-reject', !r.ok);
}

console.log(`\n✅ salvageToolArgs: ${pass} 个断言全部通过`);

