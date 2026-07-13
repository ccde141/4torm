/**
 * LoopController —— 信风常驻循环蹦床
 *
 * 把「单圈 Orchestrator」串成常驻循环：
 * - 每圈拉一队全新 Orchestrator（新 executionId / 干净上下文），无注意力衰减
 * - Output 到达 = 本圈 settled('done')，读 output.json → 按 carryOver 备下圈输入
 * - relative 节拍：本圈跑完 abortableSleep(gapSec) 再起下圈（天然不叠）
 * - lapBound 到顶 / stop() / 本圈 error|stopped → 循环结束
 *
 * 本刀只做 relative 单档；absolute + 潮汐目标是后续刀。
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import type { WorkflowGraph, NodeExecutor, WorkflowMode } from '../foundation/types';
import { Orchestrator } from './orchestrator';
import { abortableSleep } from '../execution/delivery-delay';
import { summarizeLap } from './lap-summarizer';

/** 循环配置（本刀仅 relative） */
export interface LoopConfig {
  cadence: { kind: 'relative'; gapSec: number };
  lapBound: number | null;              // null=永续
  carryOver: 'accumulate' | 'reset' | 'summary';
  loopNote?: string;
  /** carryOver='summary' 时的自定义摘要指令，可空 → 用默认 */
  summaryPrompt?: string;
}

export interface LoopControllerOptions {
  graph: WorkflowGraph;
  dataDir: string;
  workflowId: string;
  executors: Map<string, NodeExecutor>;
  initialInput?: string;
  mode?: WorkflowMode;
  loop: LoopConfig;
  /** 每圈起跑时回调，把当前圈 Orchestrator 交给路由层转发 events/status */
  onLapStart?: (orch: Orchestrator) => void;
}

export class LoopController {
  private readonly opts: LoopControllerOptions;
  private current: Orchestrator | null = null;
  private running = false;
  private stopped = false;
  private lapIndex = 0;
  private readonly gapAbort = new AbortController();

  constructor(opts: LoopControllerOptions) {
    this.opts = opts;
  }

  isRunning(): boolean { return this.running; }
  getCurrentOrchestrator(): Orchestrator | null { return this.current; }
  getLapIndex(): number { return this.lapIndex; }

  /** 启动循环（后台自跑，不阻塞调用方） */
  async start(): Promise<void> {
    if (this.running) throw new Error('LoopController already running');
    this.running = true;
    void this.runLoop();
  }

  /** 停止整个循环：中断 gap 等待 + 停当前圈 */
  async stop(): Promise<void> {
    this.stopped = true;
    this.gapAbort.abort();
    if (this.current) await this.current.stop();
    this.running = false;
  }

  // ── 内部：循环体 ──────────────────────────────────────────────

  private async runLoop(): Promise<void> {
    const { graph, dataDir, workflowId, executors, mode, loop } = this.opts;
    let carriedInput = this.opts.initialInput ?? '';

    try {
      while (!this.stopped) {
        this.lapIndex += 1;
        const lapTotal = loop.lapBound;

        const orch = new Orchestrator({
          graph, dataDir, workflowId, executors, mode,
          initialInput: carriedInput,
          loopContext: {
            lapIndex: this.lapIndex,
            lapTotal,
            loopNote: loop.loopNote,
          },
        });
        this.current = orch;
        this.opts.onLapStart?.(orch);

        await orch.start();
        const outcome = await orch.whenSettled();

        // 只有正常完成才续圈；出错/被停 → 终止循环
        if (outcome !== 'done' || this.stopped) break;

        // 圈数上界
        if (lapTotal !== null && this.lapIndex >= lapTotal) break;

        // 备下圈输入：
        // - accumulate 带本圈产出全文
        // - reset 只留框定语（loopNote 由信封皮带）
        // - summary 把本圈产出压成摘要 + 框定语
        if (loop.carryOver === 'accumulate') {
          carriedInput = this.composeAccumulated(await this.readLapOutput(orch.getRunDir()));
        } else if (loop.carryOver === 'summary') {
          const summary = await summarizeLap({
            runDir: orch.getRunDir(),
            dataDir,
            graph,
            summaryPrompt: loop.summaryPrompt,
            signal: this.gapAbort.signal,
          });
          carriedInput = this.composeAccumulated(summary);
        } else {
          carriedInput = loop.loopNote ?? '';
        }

        // relative 节拍：跑完等 gapSec 再起下圈，可被 stop 中断
        const slept = await abortableSleep(loop.cadence.gapSec, this.gapAbort.signal);
        if (slept === 'aborted' || this.stopped) break;
      }
    } finally {
      this.running = false;
    }
  }

  /** 读本圈 output.json（[{source,content,timestamp}]），拼成产出文本 */
  private async readLapOutput(runDir: string): Promise<string> {
    try {
      const raw = await fs.readFile(path.join(runDir, 'output.json'), 'utf-8');
      const arr = JSON.parse(raw) as Array<{ content?: string }>;
      return arr.map(e => e.content ?? '').filter(Boolean).join('\n\n---\n\n');
    } catch {
      return '';
    }
  }

  /** accumulate：把上圈产出 + 循环框定语拼成下圈输入 */
  private composeAccumulated(prevOutput: string): string {
    const note = this.opts.loop.loopNote?.trim();
    if (prevOutput && note) return `${note}\n\n[上一圈产出]\n${prevOutput}`;
    return prevOutput || note || '';
  }
}
