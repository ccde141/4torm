/**
 * AutoProfile —— 自动模式的循环档案（前提④：一个工作流挂多套跑法）
 *
 * 设计依据：信风循环-数据结构草案 §3.2
 *
 * 归属（三层坐标）：
 * - 循环内生于 auto 模式，manual 无"圈"概念，故循环配置不与 mode 平级。
 * - AutoProfile 存独立 profiles.json，与 graph.json/meta.json 平级；图保持 mode-free。
 * - 一个工作流可挂多套 profile（"每小时档" / "开发接力档"），启动时 mode=auto + 选 profileId。
 */

/** 循环节拍 */
export type Cadence =
  /** 信风自循环：本圈跑完等 gapSec 再起下圈，天然不叠。本刀已接线。 */
  | { kind: 'relative'; gapSec: number }
  /** 潮汐纯闹钟：时间到只戳一下，叠跑判定归 LoopController。占位，第⑤刀接潮汐。 */
  | { kind: 'absolute'; by: 'tide' };

/** 单套自动跑法 */
export interface AutoProfile {
  /** 档案 ID（工作流内唯一） */
  id: string;
  /** 人类可读名，如"每小时档" */
  name: string;
  /** 循环节拍 */
  cadence: Cadence;
  /**
   * 叠跑策略，仅 absolute（潮汐触发）有意义：本轮还在跑时新触发到达该跳过还是排队。
   * relative 结构上不可能叠，此字段被忽略。本刀存下但 LoopController 不读。
   */
  overlap: 'skip' | 'queue';
  /** 圈数上界，null=永续（直到人为停止 / 条件满足） */
  lapBound: number | null;
  /** 结转：accumulate 带上圈产出全文，reset 只留框定语，summary 把产出压成摘要再带 */
  carryOver: 'accumulate' | 'reset' | 'summary';
  /** 续跑框定语（非数据）：每圈经信封皮投回 input。缺省无框定。 */
  loopNote?: string;
  /** carryOver='summary' 时的自定义摘要指令（喂给摘要 LLM 的 system prompt）。缺省用内置默认。 */
  summaryPrompt?: string;
}

/** 一个工作流挂的全部档案（对应 profiles.json） */
export interface WorkflowAutoProfiles {
  workflowId: string;
  profiles: AutoProfile[];
}
