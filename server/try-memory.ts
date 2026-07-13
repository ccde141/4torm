/**
 * 手动试玩脚本：验证记忆"写入→落盘→召回"闭环。
 *   cd server && npx tsx try-memory.ts
 * 用真实 agent 家目录（代码助手），跑完可去 data/agents/{id}/memory/ 看文件。
 */
import path from 'node:path';
import { writeMemory, recallMemory, listMemory } from './src/engine/shared/agent-memory';

const dataDir = path.resolve('..', 'data');   // 4torm/data
const agentId = 'agent-mop6zz2fdpjv';          // 代码助手

async function main() {
  console.log('=== ① 模拟季风里你纠正它（写入 feedback 常驻档）===');
  const a = await writeMemory(dataDir, agentId, {
    summary: '本项目文件落盘必须原子写',
    detail: '用 tmp+rename，禁裸 writeFile。为什么：防崩溃时半截文件损坏状态。',
    category: 'feedback', tags: ['写入', '数据安全'],
    source: 'conversation', now: new Date().toISOString(),
  });
  console.log('  写入 slug =', a.slug);

  console.log('\n=== ② 模拟对流里踩坑（写入 pitfall 情境档）===');
  const b = await writeMemory(dataDir, agentId, {
    summary: 'pdf-parse 对扫描件返回空，需先判扫描件走 OCR',
    detail: '扫描版 PDF 无文本层，pdf-parse 返回空串；应先探测再决定走 OCR。',
    category: 'pitfall', tags: ['pdf', 'ocr', '解析'],
    source: 'convection', now: new Date().toISOString(),
  });
  console.log('  写入 slug =', b.slug);

  console.log('\n=== 当前记忆索引 ===');
  console.log((await listMemory(dataDir, agentId)).map(r => `  - ${r.slug} [${r.category}]`).join('\n'));

  console.log('\n=== ③ 模拟"下次上场"：任务与 pdf 无关 ===');
  const r1 = await recallMemory(dataDir, agentId, '帮我写一个日报生成脚本');
  console.log(r1 || '(空)');
  console.log('  ↑ 只该出现 feedback 常驻档（原子写），pdf 那条不该出现');

  console.log('\n=== ④ 模拟"下次上场"：任务提到 pdf 解析 ===');
  const r2 = await recallMemory(dataDir, agentId, '解析这批 pdf 发票');
  console.log(r2 || '(空)');
  console.log('  ↑ 原子写(常驻) + pdf(情境命中) 都该出现');
}

main().catch(e => { console.error(e); process.exit(1); });
