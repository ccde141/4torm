/**
 * 自动模式的循环档案。一个工作流可在 profiles.json 中保存多套配置。
 */

/** 循环节拍 */
export type Cadence =
  /** 信风自循环：本圈跑完等 gapSec 再起下圈。 */
  | { kind: 'relative'; gapSec: number }
  /** 潮汐触发的预留配置；当前循环执行器不处理此类型。 */
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
   * 当前循环执行器不读取此字段。
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
