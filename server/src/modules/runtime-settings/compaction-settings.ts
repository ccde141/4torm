import { loadCompactionPolicy, parseCompactionPolicy, saveCompactionPolicy,
  resolveSummaryModelBudget, summaryStageBudget, estimateTextTokens, generateCompactionResult,
  type CompactionPolicy } from '../../engine/shared/compaction/index.js';
import { frameworkError } from '../../engine/shared/framework-error.js';

export type CompressionModelTest = (model: string) => Promise<void>;

/** Host settings own validation/persistence; feature islands only read the shared policy. */
export class CompactionSettings {
  private writeQueue: Promise<unknown> = Promise.resolve();
  constructor(private readonly dataDir: string,
    private readonly verify: CompressionModelTest = model => verifyModel(dataDir, model)) {}

  read(): Promise<CompactionPolicy> { return loadCompactionPolicy(this.dataDir); }

  write(input: unknown): Promise<CompactionPolicy> {
    const policy = parseCompactionPolicy(input);
    const operation = this.writeQueue.then(async () => {
      const previous = await this.read();
      if (policy.modelMode === 'fixed' && (previous.modelMode !== 'fixed'
        || previous.fixedModel !== policy.fixedModel)) await this.verify(policy.fixedModel!);
      return saveCompactionPolicy(this.dataDir, policy);
    });
    // A rejected write must not poison later independent human operations.
    this.writeQueue = operation.catch(() => undefined);
    return operation;
  }

  async test(input: unknown): Promise<{ ok: true; model: string }> {
    if (!input || typeof input !== 'object' || !('model' in input)
      || typeof input.model !== 'string' || !input.model.trim()) throw frameworkError({
      code: 'COMPACTION_MODEL_INVALID', kind: 'validation', message: '请选择压缩模型',
      source: 'runtime-settings', retryable: false,
    });
    await this.verify(input.model);
    return { ok: true, model: input.model };
  }
}

async function verifyModel(dataDir: string, model: string): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('压缩模型验证超时')), 30_000);
  try {
    const limits = await resolveSummaryModelBudget(dataDir, model);
    const text = '资料已读取，校验仍在等待。下一步核对内容，不要宣布任务完成。';
    const budget = summaryStageBudget(estimateTextTokens(text), true, limits);
    const result = await generateCompactionResult({ dataDir, model, ...budget, signal: controller.signal,
      prompt: '将给定记录压缩为一句简短事实，保留尚未完成的工作。只返回摘要。',
      text });
    if (result.source !== 'model') throw new Error('模型已响应，但未在输出限额内生成压缩正文，无法验证压缩能力');
  } finally { clearTimeout(timer); }
}
