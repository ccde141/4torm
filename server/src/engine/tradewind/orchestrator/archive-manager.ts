/**
 * 归档管理器 —— meta.json 写入 + 执行结束标记 + 启动自愈
 *
 * 职责：
 * - start 时写 meta.json（executionId, workflowId, startTime, status: 'running'）
 * - end 时更新 meta.json（endTime, status: 'done' | 'error'）
 * - 启动自愈：扫描 data/tradewind/runs/ 下 status='running' 的遗留执行，标记为 'crashed'
 *
 * 归档写入失败不阻塞主流程（log + 继续）
 */

import fs from 'node:fs/promises';
import path from 'node:path';

export interface ExecutionMeta {
  executionId: string;
  workflowId: string;
  startTime: string;
  endTime?: string;
  status: 'running' | 'done' | 'error' | 'crashed';
}

export class ArchiveManager {
  private readonly runDir: string;
  private readonly metaPath: string;
  private meta: ExecutionMeta;

  constructor(runDir: string, executionId: string, workflowId: string) {
    this.runDir = runDir;
    this.metaPath = path.join(runDir, 'meta.json');
    this.meta = {
      executionId,
      workflowId,
      startTime: new Date().toISOString(),
      status: 'running',
    };
  }

  /** 写入初始 meta.json，创建 runDir */
  async writeStart(): Promise<void> {
    try {
      await fs.mkdir(this.runDir, { recursive: true });
      await fs.writeFile(this.metaPath, JSON.stringify(this.meta, null, 2));
    } catch (err) {
      console.warn('[archive] writeStart failed:', (err as Error).message);
    }
  }

  /** 标记执行结束 */
  async writeEnd(status: 'done' | 'error'): Promise<void> {
    this.meta.endTime = new Date().toISOString();
    this.meta.status = status;
    try {
      await fs.writeFile(this.metaPath, JSON.stringify(this.meta, null, 2));
    } catch (err) {
      console.warn('[archive] writeEnd failed:', (err as Error).message);
    }
  }

  /** 启动自愈：扫描 runsRoot 下所有 meta.json，把 status='running' 标记为 'crashed' */
  static async healCrashed(runsRoot: string): Promise<number> {
    let healed = 0;
    try {
      const wfDirs = await fs.readdir(runsRoot).catch(() => [] as string[]);
      for (const wfDir of wfDirs) {
        const wfPath = path.join(runsRoot, wfDir);
        const stat = await fs.stat(wfPath).catch(() => null);
        if (!stat?.isDirectory()) continue;

        const execDirs = await fs.readdir(wfPath).catch(() => [] as string[]);
        for (const execDir of execDirs) {
          const metaPath = path.join(wfPath, execDir, 'meta.json');
          try {
            const raw = await fs.readFile(metaPath, 'utf-8');
            const meta: ExecutionMeta = JSON.parse(raw);
            if (meta.status === 'running') {
              meta.status = 'crashed';
              meta.endTime = new Date().toISOString();
              await fs.writeFile(metaPath, JSON.stringify(meta, null, 2));
              healed++;
            }
          } catch {
            // meta.json 不存在或损坏，跳过
          }
        }
      }
    } catch (err) {
      console.warn('[archive] healCrashed failed:', (err as Error).message);
    }
    return healed;
  }
}
