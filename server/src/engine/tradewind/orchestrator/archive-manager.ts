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
import { atomicWriteFile } from '../../shared/atomic-io.js';

export interface ExecutionMeta {
  executionId: string;
  workflowId: string;
  startTime: string;
  endTime?: string;
  status: 'running' | 'done' | 'error' | 'stopped' | 'crashed';
}

export class ArchiveManager {
  private readonly runDir: string;
  private readonly metaPath: string;
  private meta: ExecutionMeta;
  /** 终结状态写一次即锁定：首个 writeEnd 胜出，防止 stop() 覆写 handleNodeDone 已写的 'done'。 */
  private ended = false;

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
      await atomicWriteFile(this.metaPath, JSON.stringify(this.meta, null, 2));
    } catch (err) {
      console.warn('[archive] writeStart failed:', (err as Error).message);
    }
  }

  /** 标记执行结束。'stopped' = 被外部 stop() 中止（未跑到 output 终点）。 */
  async writeEnd(status: 'done' | 'error' | 'stopped'): Promise<void> {
    if (this.ended) return; // 首个终结状态胜出（done/error 优先于随后的 stop→stopped）
    this.ended = true;
    this.meta.endTime = new Date().toISOString();
    this.meta.status = status;
    try {
      await atomicWriteFile(this.metaPath, JSON.stringify(this.meta, null, 2));
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
              await atomicWriteFile(metaPath, JSON.stringify(meta, null, 2));
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
