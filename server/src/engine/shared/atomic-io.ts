/**
 * 共享底层原子写原语（信风 / shared 层通用）。
 *
 * 只是「先写 .tmp 再 rename 覆盖」的纯 IO 原语，不含任何业务逻辑，
 * 故不违反「模块间零业务交叉代码」——各业务模块（对流 / 气旋 / 潮汐）仍各自持有本地实现。
 *
 * 目的：进程若在写盘途中被杀（关软件 / 崩溃），rename 的原子性保证目标文件
 * 要么是完整旧内容、要么是完整新内容，绝不会留下半截 JSON 损坏持久状态。
 */

import fs from 'node:fs/promises';

export async function atomicWriteFile(filePath: string, data: string): Promise<void> {
  const tmp = `${filePath}.tmp`;
  await fs.writeFile(tmp, data, 'utf-8');
  await fs.rename(tmp, filePath);
}
