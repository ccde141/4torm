import { callMemoryRecallModel, loadMemoryRecallSettings, saveMemoryRecallSettings, cancelRecallWorkers,
  type MemoryRecallResult } from '../../engine/shared/memory-recall/index.js';
import { frameworkError } from '../../engine/shared/framework-error.js';
import { embedTexts } from '../../model-runtime/embeddings.js';
import { runRecallWorker } from '../../engine/shared/memory-recall/worker.js';
import { assertRecallModel } from '../../engine/shared/memory-recall/settings.js';

/** Global configuration and a synthetic manual check; automatic conversation recall is a separate consumer. */
export class MemoryRecallSettingsService {
  constructor(private readonly dataDir: string) {}
  read() { return loadMemoryRecallSettings(this.dataDir); }
  async write(input: unknown) {
    const settings = await saveMemoryRecallSettings(this.dataDir, input);
    cancelRecallWorkers(this.dataDir);
    return settings;
  }
  async test(input: unknown, signal?: AbortSignal): Promise<MemoryRecallResult | { model: string; dimensions: number; elapsedMs: number; usage?: never }> {
    if (!input || typeof input !== 'object' || Array.isArray(input)
      || Object.keys(input).some(key => !['model', 'kind'].includes(key))
      || ('kind' in input && !['embedding', 'search'].includes(String(input.kind)))
      || !('model' in input) || typeof input.model !== 'string' || !input.model.trim()) {
      throw frameworkError({ code: 'MEMORY_RECALL_SETTINGS_INVALID', kind: 'validation',
        message: '请选择记忆召回模型', source: 'memory-recall', retryable: false });
    }
    await assertRecallModel(this.dataDir, input.model);
    if ('kind' in input && input.kind === 'embedding') {
      const started = performance.now();
      let vector: number[];
      try { [vector] = await embedTexts(this.dataDir, input.model, ['项目文档使用中文。'], signal); }
      catch {
        signal?.throwIfAborted();
        throw frameworkError({ code: 'MEMORY_RECALL_EMBEDDING_FAILED', kind: 'provider',
          message: '嵌入模型验证失败，请检查模型是否支持嵌入接口及连接配置', source: 'memory-recall', retryable: false });
      }
      return { model: input.model, dimensions: vector.length, elapsedMs: Math.round(performance.now() - started) };
    }
    if ('kind' in input && input.kind === 'search') return this.testSearch(input.model, signal);
    const result = await callMemoryRecallModel(this.dataDir, {
      query: '项目里约定文档使用哪种语言？', candidates: [
        { id: 'language', summary: '项目文档使用中文，保留必要英文术语。' },
        { id: 'weather', summary: '今天下午可能下雨。' },
      ],
    }, { model: input.model, signal });
    if (result.selectedIds.length !== 1 || result.selectedIds[0] !== 'language') {
      throw frameworkError({ code: 'MEMORY_RECALL_VERIFICATION_FAILED', kind: 'provider',
        message: '模型已响应，但未通过示例候选筛选', source: 'memory-recall', retryable: false });
    }
    return result;
  }

  private async testSearch(model: string, signal?: AbortSignal): Promise<MemoryRecallResult> {
    const started = performance.now();
    const documents = [{ id: 'language', title: '文档语言', summary: '项目文档使用中文', content: '项目文档使用中文，保留必要英文术语。' },
      { id: 'weather', title: '天气记录', summary: '下午下雨', content: '今天下午可能下雨。' }]
      .map(value => ({ ...value, kind: 'memory' as const, agentId: 'verification', timestamp: '2026-01-01T00:00:00Z', revision: 'sample' }));
    const result = await runRecallWorker({ dataDir: this.dataDir, model, query: '项目里约定文档使用哪种语言？',
      scope: { agentId: 'verification', sessionId: 'verification' }, candidates: documents.map(document => ({ ...document, excerpt: document.content })),
      signal: signal ?? new AbortController().signal, sources: { sync: async () => {},
        list: async () => documents, read: async (_owner, id) => documents.find(value => value.id === id) ?? null } });
    if (result.cards.length !== 1 || result.cards[0].id !== 'language') throw frameworkError({
      code: 'MEMORY_RECALL_VERIFICATION_FAILED', kind: 'provider', message: '模型未通过示例资料搜索与读取',
      source: 'memory-recall', retryable: false });
    return { model, selectedIds: ['language'], elapsedMs: Math.round(performance.now() - started), usage: result.usage?.total };
  }
}
