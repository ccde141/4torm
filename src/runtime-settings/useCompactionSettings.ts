import { useEffect, useState } from 'react';
import { readCompactionSettings, saveCompactionSettings, testCompactionModel,
  type CompactionPolicy } from '../api/compaction-settings';
import { getAllModels } from '../llm';
import { useLocale } from '../i18n/LocaleContext';

export function useCompactionSettings() {
  const { t } = useLocale();
  const [policy, setPolicy] = useState<CompactionPolicy | null>(null);
  const [models, setModels] = useState<Array<{ key: string; label: string }>>([]);
  const [busy, setBusy] = useState<'save' | 'test' | null>(null);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let alive = true;
    setError('');
    Promise.all([readCompactionSettings(), getAllModels()]).then(([next, choices]) => {
      if (alive) { setPolicy(next); setModels(choices); }
    }).catch(err => { if (alive) setError(String(err.message ?? err)); });
    return () => { alive = false; };
  }, [revision]);
  const update = (patch: Partial<CompactionPolicy>) => {
    setFeedback(''); setError(''); setPolicy(previous => previous && { ...previous, ...patch });
  };
  async function act(action: 'save' | 'test') {
    if (!policy || busy) return;
    setBusy(action); setError(''); setFeedback('');
    try {
      if (action === 'test') {
        await testCompactionModel(policy.fixedModel ?? ''); setFeedback(t('compaction.tested'));
      } else {
        setPolicy(await saveCompactionSettings(policy)); setFeedback(t('compaction.saved'));
      }
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(null); }
  }
  return { policy, models, busy, error, feedback, update, act,
    reload: () => setRevision(value => value + 1) };
}
