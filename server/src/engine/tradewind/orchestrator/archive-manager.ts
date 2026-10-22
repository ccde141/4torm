/**
 * 归档管理器 —— meta.json 写入 + 执行结束标记 + 启动自愈
 *
 * 职责：
 * - start 时写 meta.json（executionId, workflowId, startTime, status: 'running'）
 * - end 时更新 meta.json（endTime, status: 'done' | 'error'）
 * - 启动自愈：扫描 data/tradewind/runs/ 下 status='running' 的遗留执行，标记为 'crashed'
 *
 * 写入失败向编排器报告；不得将内存终态冒充已提交的运行事实。
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { atomicWriteFile } from '../../shared/atomic-io.js';
import { FrameworkError } from '../../shared/framework-error.js';

export interface ExecutionMeta {
  executionId: string;
  workflowId: string;
  startTime: string;
  endTime?: string;
  status: 'running' | 'done' | 'error' | 'stopped' | 'crashed';
  trigger?: { source: 'user' | 'conversation'; sessionId?: string; agentId?: string };
  errorCode?: string;
  errorMessage?: string;
}

export class ArchiveManager {
  private readonly runDir: string;
  private readonly metaPath: string;
  private meta: ExecutionMeta;
  /** 首个成功提交的终态锁定；失败不能阻止明确的后续持久化调用。 */
  private ended = false;
  private started = false;
  private endCommit: Promise<void> | null = null;

  constructor(runDir: string, executionId: string, workflowId: string, trigger?: ExecutionMeta['trigger']) {
    this.runDir = runDir;
    this.metaPath = path.join(runDir, 'meta.json');
    this.meta = {
      executionId,
      workflowId,
      startTime: new Date().toISOString(),
      status: 'running',
      ...(trigger ? { trigger } : {}),
    };
  }

  hasStarted(): boolean { return this.started; }

  /** 写入初始 meta.json，创建 runDir */
  async writeStart(): Promise<void> {
    try {
      await fs.mkdir(this.runDir, { recursive: true });
      await atomicWriteFile(this.metaPath, JSON.stringify(this.meta, null, 2));
      this.started = true;
    } catch (err) {
      throw this.writeError('start', err);
    }
  }

  /** 标记执行结束。'stopped' = 被外部 stop() 中止（未跑到 output 终点）。 */
  async writeEnd(status: 'done' | 'error' | 'stopped'): Promise<void> {
    const previous = this.endCommit ?? Promise.resolve();
    const current = previous.catch(() => {}).then(() => this.commitEnd(status));
    this.endCommit = current;
    try { await current; }
    finally { if (this.endCommit === current) this.endCommit = null; }
  }

  /** 条件交接收尾的事实提交失败可将已写终态降级，避免磁盘仍冒充正常完成。 */
  async recordFailure(error: FrameworkError): Promise<void> {
    const next: ExecutionMeta = { ...this.meta, status: 'error', endTime: new Date().toISOString(),
      errorCode: error.data.code, errorMessage: error.message };
    try { await atomicWriteFile(this.metaPath, JSON.stringify(next, null, 2)); }
    catch (cause) { throw this.writeError('end', cause); }
    this.meta = next;
    this.ended = true;
  }

  private async commitEnd(status: 'done' | 'error' | 'stopped'): Promise<void> {
    if (this.ended) return;
    const next = { ...this.meta, endTime: new Date().toISOString(), status };
    try {
      await atomicWriteFile(this.metaPath, JSON.stringify(next, null, 2));
    } catch (err) {
      throw this.writeError('end', err);
    }
    this.meta = next;
    this.ended = true;
  }

  private writeError(stage: 'start' | 'end', cause: unknown): FrameworkError {
    return new FrameworkError({
      code: 'TRADEWIND_ARCHIVE_WRITE_FAILED', kind: 'io',
      message: stage === 'start' ? '信风启动记录未能保存，工作流未开始执行'
        : '信风终态记录未能保存，请检查运行归档；不会自动重新执行工作流',
      source: 'tradewind.archive', retryable: false,
      details: { stage, executionId: this.meta.executionId, workflowId: this.meta.workflowId },
    }, { cause });
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
