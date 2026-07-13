/**
 * 信封草稿（EnvelopeDraft）—— 自动模式下 Agent 多轮累积的交接内容
 *
 * 背景（决策报告 §三）：自动模式的信封不再是"边上预声明的类型化槽"，而是 Agent 在
 * 多轮 react 里自己维护的一组**纯文本条目**（不带键），最终由 complete_task 封口 +
 * 附一段自由备注，序列化成 Envelope.content 丢给下游。
 *
 * 复用气旋公告板（cyclone/bulletin.ts）的「条目 + 增量操作 + summarize」心智模型，
 * 但**刻意砍掉**其文件落盘 / 审计时间轴 / 撤回 / 并发防护 —— 信封草稿是单 Agent、
 * 单次 run、内存级、单写者，那套并发/审计机器在这里是过度设计。
 *
 * id 用自增计数器（e1/e2/…）而非时间戳随机串：单写者下足够唯一，且可确定性测试。
 */

/** 一条交接条目：纯文本，不带键 */
export interface DraftEntry {
  id: string;
  text: string;
}

/** 条目数上限（防失控刷屏，与气旋公告板同量级） */
const MAX_ENTRIES = 60;
/** 单条文本上限 */
const MAX_TEXT = 4000;

export class EnvelopeDraft {
  private readonly entries: DraftEntry[] = [];
  private seq = 0;

  /** 增：加一条条目。返回新条目；文本空白或超额返回 null（由调用方转成工具反馈）。 */
  add(text: string): DraftEntry | null {
    const t = String(text ?? '').trim().slice(0, MAX_TEXT);
    if (!t) return null;
    if (this.entries.length >= MAX_ENTRIES) return null;
    const entry: DraftEntry = { id: `e${++this.seq}`, text: t };
    this.entries.push(entry);
    return entry;
  }

  /** 删：按 id 删一条。返回是否删除了（false = 无此 id）。 */
  remove(id: string): boolean {
    const i = this.entries.findIndex(e => e.id === id);
    if (i < 0) return false;
    this.entries.splice(i, 1);
    return true;
  }

  /** 扫：列出全部条目（只读快照）。 */
  list(): readonly DraftEntry[] {
    return this.entries.slice();
  }

  isEmpty(): boolean {
    return this.entries.length === 0;
  }

  /** 人读摘要：给工具反馈用（增/删/扫后回填给模型，让它看到当前信封全貌）。 */
  summarize(): string {
    if (!this.entries.length) return '（信封草稿为空）';
    return this.entries.map(e => `- [${e.id}] ${e.text}`).join('\n');
  }

  /**
   * 封口：把已累积的结构化条目 + 一段自由备注序列化成下游可读的 Envelope.content。
   * 下游拿到 = 结构化条目（硬信息，精确）＋ 自由备注（交接说明，顺滑）。
   * 两段都可能为空：允许纯备注交接，也允许无备注纯条目交接。
   */
  seal(note?: string): string {
    const n = String(note ?? '').trim();
    const parts: string[] = [];

    if (this.entries.length) {
      const lines = this.entries.map((e, i) => `${i + 1}. ${e.text}`).join('\n');
      parts.push(`## 交接信息\n${lines}`);
    }
    if (n) {
      parts.push(`## 交接备注\n${n}`);
    }
    if (!parts.length) {
      // 既无条目也无备注：仍视为有效完成，但给下游一个明确的空交接标记
      return '（上游已完成任务，但未留下结构化条目或备注。）';
    }
    return parts.join('\n\n');
  }
}

// ── 工具执行 ──────────────────────────────────────────────────────

/** 终结工具名：native 循环识别到此工具调用即封口交接、结束本节点本轮（决策报告 §一）。 */
export const COMPLETE_TASK_TOOL = 'complete_task';

/** 自动模式全部信封工具名（node-runner 的 toolCaller 按名拦截路由到本执行器）。 */
export const ENVELOPE_TOOL_NAMES = ['envelope_add', 'envelope_remove', 'envelope_list', COMPLETE_TASK_TOOL] as const;

/**
 * 判定"当前这一轮是否为信封轮"——决定是否挂信封四件套 + 终结门 + 封口投递。
 *
 * 关键原则（双平面分离）：终结门和信封投递属于"处理上游工作信封"这件事，
 * 不属于模式。三种轮里只有 envelope 轮该挂：
 * - envelope（上游工作信封）：主工作轮，可攒信封 + complete_task 封口投递下游。
 * - human（人类聊天）/ contact（横向被联络）：纯对话，不挂工具、不挂门、不投递。
 *
 * 且仅 native 成立：text 循环无可靠终结信号，保持"一轮→最后文本下发"现状（零回归）。
 * 自动模式 vs 手动模式在此层无差异——差异退到编排层（native-only、有无会议室/暂停点）。
 */
export function isEnvelopeRound(source: string, native: boolean | undefined): boolean {
  return native === true && source === 'envelope';
}

/** 一轮被中断时的处置。 */
export type RoundInterrupt =
  | 'pause'       // 暂停：扣住信封、绝不 onComplete（续跑时重跑本轮）
  | 'deliver'     // 全局停止/错误：信封来源必须 onComplete 兜底，否则下游/发起方悬挂
  | 'silent';     // 纯对话轮（human）被中断：无投递承诺，静默收尾

/**
 * 判定一轮 react 被异常中断后如何处置——这是"永不投垃圾下游"的关键闸。
 *
 * @param isAbort      异常是否为 AbortError（中止而非真错误）
 * @param pausing      是否由 pause() 主动触发（区分"暂停" vs "全局停止"）
 * @param carriesEnvelope 本轮是否承载 onComplete（envelope/contact 来源）
 *
 * 规则：
 * - 暂停（pause() 触发的轮级 abort）且承载信封 → 'pause'：扣住，绝不投递。
 * - 承载信封的其它中断（全局停止 / 错误）→ 'deliver'：必须兜底 onComplete。
 * - 不承载信封（human 轮）→ 'silent'：无承诺，静默。
 */
export function classifyRoundInterrupt(
  isAbort: boolean,
  pausing: boolean,
  carriesEnvelope: boolean,
): RoundInterrupt {
  if (isAbort && pausing && carriesEnvelope) return 'pause';
  if (carriesEnvelope) return 'deliver';
  return 'silent';
}

/**
 * 执行一个信封工具，返回回填给模型的结果文本。
 *
 * 增/删/扫：改草稿并回填当前信封全貌（让模型每步都看到累积结果）。
 * complete_task：返回封口后的交接内容（= Envelope.content）；循环据工具名判定终结，
 *   把此返回值作为最终交付，不再续轮。
 */
export function execEnvelopeTool(
  draft: EnvelopeDraft,
  tool: string,
  args: Record<string, string>,
): string {
  switch (tool) {
    case 'envelope_add': {
      const e = draft.add(args.text ?? '');
      if (!e) return `envelope_add 失败：text 为空或已达条目上限。\n当前信封：\n${draft.summarize()}`;
      return `已添加条目 [${e.id}]。\n当前信封：\n${draft.summarize()}`;
    }
    case 'envelope_remove': {
      const ok = draft.remove(args.id ?? '');
      return ok
        ? `已删除 [${args.id}]。\n当前信封：\n${draft.summarize()}`
        : `未找到条目 ${args.id}。\n当前信封：\n${draft.summarize()}`;
    }
    case 'envelope_list':
      return `当前信封：\n${draft.summarize()}`;
    case COMPLETE_TASK_TOOL:
      return draft.seal(args.note);
    default:
      return `未知信封工具：${tool}`;
  }
}
