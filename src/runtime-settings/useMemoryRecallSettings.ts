import { useEffect, useRef, useState } from 'react';
import { readMemoryRecallSettings, saveMemoryRecallSettings, testMemoryRecallModel, testMemoryRecallEmbedding,
  memoryRecallLevels, type MemoryRecallSettings } from '../api/memory-recall-settings';
import { getAllModels } from '../llm';
import { useLocale } from '../i18n/LocaleContext';
import { memoryRecallError } from './memory-recall-errors';
import type { MessageKey, MessageValues } from '../i18n/locale';

export function useMemoryRecallSettings() {
  const { t } = useLocale();
  const [settings, setSettings] = useState<MemoryRecallSettings | null>(null);
  const [models, setModels] = useState<Array<{ key: string; label: string }>>([]);
  const [busy, setBusy] = useState<'save' | 'test' | 'embedding' | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [feedback, setFeedback] = useState<{ key: MessageKey; values?: MessageValues } | null>(null);
  const [revision, setRevision] = useState(0);
  const pending = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; pending.current?.abort(); };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    Promise.all([readMemoryRecallSettings(controller.signal), getAllModels()]).then(([next, choices]) => {
      if (!controller.signal.aborted) { setSettings({ ...next, ...memoryRecallLevels(next) }); setModels(choices); }
    }).catch(err => { if (!controller.signal.aborted) setError(err); });
    return () => controller.abort();
  }, [revision]);
  function update(patch: Partial<MemoryRecallSettings>) {
    setError(null); setFeedback(null); setSettings(value => {
      if (!value) return value;
      const next = { ...value, ...patch }, levels = memoryRecallLevels(next);
      return { ...next, ...levels, enabled: levels.level1Enabled || levels.level2Enabled };
    });
  }
  async function act(action: 'save' | 'test' | 'embedding') {
    if (!settings || pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(action); setError(null); setFeedback(null);
    try {
      if (action === 'save') {
        const saved = await saveMemoryRecallSettings(settings, controller.signal);
        if (mounted.current && !controller.signal.aborted) { setSettings(saved); setFeedback({ key: 'recall.saved' }); }
      } else if (action === 'embedding') {
        const result = await testMemoryRecallEmbedding(settings.embeddingModel ?? '', controller.signal);
        if (mounted.current && !controller.signal.aborted) setFeedback({ key: 'recall.embeddingTested', values: { dimensions: result.dimensions } });
      } else {
        const result = await testMemoryRecallModel(settings.model ?? '', controller.signal);
        if (mounted.current && !controller.signal.aborted) setFeedback({ key: 'recall.tested', values: {
          seconds: (result.elapsedMs / 1000).toFixed(2),
        } });
      }
    } catch (err) {
      if (mounted.current) {
        if (controller.signal.aborted) setFeedback({ key: 'recall.cancelled' });
        else setError(err);
      }
    } finally {
      if (pending.current === controller) pending.current = null;
      if (mounted.current) setBusy(null);
    }
  }
  return { settings, models, busy, error: error ? memoryRecallError(error, t) : '',
    feedback: feedback ? t(feedback.key, feedback.values) : '', update, act,
    reload: () => setRevision(value => value + 1), cancel: () => pending.current?.abort() };
}
