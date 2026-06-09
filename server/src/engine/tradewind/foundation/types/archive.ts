/**
 * 归档元信息 —— 单次执行的元数据契约
 *
 * 设计依据：workflow-design-v2.0.md §8（归档与事件日志）
 * 决策依据：tradewind-build-guide.md §5.0 决策 2（EndStatus 三态联合）
 *
 * 关键认知：
 * - graphSnapshot 是启动时刻的图快照，保护后续画布修改不影响回看
 * - END 文件的内容就是 EndStatus 字符串；文件不存在则代表崩溃/异常
 * - NodeSnapshot 宽松定义，由各节点自决，引擎不做强约束
 */

import type { WorkflowGraph } from './workflow';

/**
 * 执行结束状态。
 *
 * - `completed`：Output 节点触发 workflow-end 事件，正常落幕
 * - `aborted`：用户手动点中止按钮
 * - `stopped`：用户通过 /stop 端点主动停止
 * - `error`：进程崩溃 / 异常被捕获 / boot-recovery 自愈补写
 */
export type EndStatus = 'completed' | 'aborted' | 'stopped' | 'error';

/**
 * 单次执行的元信息（写入 meta.json）。
 *
 * 写入时机：
 * - 执行启动时写入 startedAt / agentLocks / graphSnapshot
 * - 执行结束时补写 endedAt / endStatus（也会在 END 文件中再写一次状态）
 */
export interface ExecutionMeta {
  /** 本次执行 ID（路径段 data/tradewind/runs/{workflowId}/{executionId}/） */
  executionId: string;

  /** 工作流 ID（路径段） */
  workflowId: string;

  /** ISO 8601 启动时间 */
  startedAt: string;

  /** ISO 8601 结束时间（执行结束后补写） */
  endedAt?: string;

  /** 结束状态（执行结束后补写；崩溃情况由 boot-recovery 兜底补写 'error'） */
  endStatus?: EndStatus;

  /**
   * 本次执行占用的 Agent 实体 ID 列表。
   * 启动时写入，结束时引擎据此释放占用锁。
   * boot-recovery 自愈时也读此字段释放残留锁。
   */
  agentLocks: string[];

  /**
   * 启动时刻的图快照，保护后续修改不影响回看。
   */
  graphSnapshot: WorkflowGraph;
}

/**
 * 节点快照（NodeExecutor.snapshot? 的返回类型）。
 *
 * 决策依据：tradewind-build-guide.md §5.0 决策 5（宽松起手 + 各节点内部窄化）
 *
 * 各节点自决具体结构，归档时按 `{nodeId}.json` 单独存放。
 * 引擎不做结构校验，渲染时由对应节点的 render 组件解读。
 */
export type NodeSnapshot = Record<string, unknown>;
