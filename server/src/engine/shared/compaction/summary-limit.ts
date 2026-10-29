/** A clipped summary cannot replace its complete source. */
export class SummaryOutputLimitError extends Error {
  constructor(message = '压缩正文达到输出限额，未生成完整交接记录；原文已保留') {
    super(message);
    this.name = 'SummaryOutputLimitError';
  }
}
