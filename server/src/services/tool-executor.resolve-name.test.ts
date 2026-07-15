/**
 * resolveToolName 单测 —— 用 tsx 跑：
 *   cd server && npx tsx src/services/tool-executor.resolve-name.test.ts
 *
 * 覆盖本地模型常见脏工具名：大小写 / 空格 / functions. 前缀 /
 * namespace 分隔 / 歧义拒绝 / 无匹配。
 */

import assert from 'node:assert/strict';
import { resolveToolName } from './tool-executor';

const known = ['read_file', 'write_file', 'exec_command', 'web_search'];
let pass = 0;
function eq(name: string, got: string | null, want: string | null) {
  assert.equal(got, want, `FAIL: ${name} → got ${got}, want ${want}`);
  pass++;
}

// 精确名本就命中（此函数只在精确失败后调用，但仍应能解析）
eq('exact', resolveToolName('read_file', known), 'read_file');
// 大小写不一
eq('case', resolveToolName('Read_File', known), 'read_file');
// 两端空格
eq('spaces', resolveToolName('  write_file  ', known), 'write_file');
// functions. 前缀
eq('functions-prefix', resolveToolName('functions.exec_command', known), 'exec_command');
// tools. 前缀
eq('tools-prefix', resolveToolName('tools.web_search', known), 'web_search');
// namespace/tool 斜杠分隔 → 取末段
eq('slash-namespace', resolveToolName('mcp/read_file', known), 'read_file');
// 无匹配 → null
eq('no-match', resolveToolName('delete_everything', known), null);
// 空输入 → null
eq('empty', resolveToolName('   ', known), null);
// 空 known → null
eq('empty-known', resolveToolName('read_file', []), null);

// 歧义拒绝：known 里有大小写不同的同名 → 折叠后多个匹配 → 放弃
{
  const ambiguous = ['Search', 'search'];
  eq('ambiguous-reject', resolveToolName('SEARCH', ambiguous), null);
}

console.log(`\n✅ resolveToolName: ${pass} 个断言全部通过`);
