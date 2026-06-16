/**
 * 信风 Agent 节点事件发射器
 *
 * 事件可靠性的单一出口。所有 NodeRunner 产出的事件都经这里：
 * - 派发进程级单调 seq（前端按此对账去重）
 * - 累积当前轮"有序事件日志"roundLog（供订阅时回放）
 * - 多路推送：listeners（兼容旧端点）+ pushUnified（统一 SSE）
 *
 * 设计要点：
 * - 服务端不做渲染物化。roundLog 存原始事件，前端用同一个 reducer 回放，
 *   保证"快照回放"与"实时增量"语义永远一致（无重复实现 → 无漂移）。
 * - roundLog 在每轮开始时清空（beginRound），done/error 后保留到下一轮，
 *   让快照能拍到刚结束或进行中的轮次。
 *
 * 未来"事件没到前端" → 先看这个文件。
 */

import type { NodeRunnerEvent } from '../execution/node-runner';
import { pushUnified } from './unified-stream';

export class NodeEventEmitter {
  private readonly nodeId: string;
  private seq = 0;
  private roundLog: NodeRunnerEvent[] = [];
  private readonly listeners = new Set<(ev: NodeRunnerEvent) => void>();

  constructor(nodeId: string) {
    this.nodeId = nodeId;
  }

  /** 当前已派发的最大序号 */
  get lastSeq(): number { return this.seq; }

  /** 新一轮开始：清空上一轮日志 */
  beginRound(): void {
    this.roundLog = [];
  }

  /**
   * 发射事件。唯一变更点：派号 → 入日志 → 推三路。
   * seq 由此处注入，调用方传入的事件不应自带 seq。
   */
  emit(ev: NodeRunnerEvent): void {
    const seqd: NodeRunnerEvent = { ...ev, seq: ++this.seq };
    this.roundLog.push(seqd);
    for (const fn of this.listeners) fn(seqd);
    pushUnified('agent', this.nodeId, seqd as unknown as Record<string, unknown>);
  }

  /** 当前轮事件日志（快照用，返回副本防外部篡改） */
  getRoundLog(): NodeRunnerEvent[] {
    return [...this.roundLog];
  }

  /** 注册监听器（兼容旧 per-node /events 端点，注册时回放当前轮日志） */
  addListener(fn: (ev: NodeRunnerEvent) => void): void {
    this.listeners.add(fn);
    for (const ev of this.roundLog) fn(ev);
  }

  /** 移除监听器 */
  removeListener(fn: (ev: NodeRunnerEvent) => void): void {
    this.listeners.delete(fn);
  }
}
