import { useEffect, useRef, useState } from 'react';
import { backendFetch } from '../../lib/backend-client';
import { getSessionSnapshot, type ChatSession } from '../../store/chat';
import { hasNewCompactionCheckpoint, requestMonsoonCompaction } from '../../engine/chat/manual-compaction';
import type { MonsoonBrowserEvent } from '../../engine/chat/sse-events';
import { useLocale } from '../../i18n/LocaleContext';

interface Options {
  agentId?: string;
  sessionId: string | null;
  model: string;
  apply(session: ChatSession): void;
  progress?(sessionId: string, event: MonsoonBrowserEvent): void;
}

/** Manual compression owns its request, independently of whichever conversation is currently visible. */
export function useMonsoonCompaction(options: Options) {
  const { t } = useLocale();
  const pending = useRef(new Map<string, AbortController>());
  const [busy, setBusy] = useState<ReadonlySet<string>>(() => new Set());
  const identity = `${options.agentId ?? ''}:${options.sessionId ?? ''}`;
  const visible = useRef(identity);
  const mounted = useRef(true);
  visible.current = identity;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const compactSession = async (session: ChatSession) => {
    if (pending.current.has(session.id)) return;
    const controller = new AbortController();
    pending.current.set(session.id, controller);
    setBusy(current => new Set([...current, session.id]));
    const startedAt = Date.now();
    const fact = { id: `pending-monsoon-${startedAt}`, operation: 'compact', startedAt };
    const publish = (event: MonsoonBrowserEvent) => {
      if (mounted.current) options.progress?.(session.id, event);
    };
    publish({ ...fact, type: 'compact-start', updatedAt: startedAt });
    let acknowledged = false;
    let notice = '';
    let failure: unknown;
    let updatedAt = startedAt;
    try {
      notice = await requestMonsoonCompaction(session, options.model, controller.signal,
        { request: backendFetch, onProgress: event => {
          if (typeof event.id === 'string') fact.id = event.id;
          if (typeof event.updatedAt === 'number') updatedAt = event.updatedAt;
          publish(event);
        } });
      acknowledged = true;
    } catch (error) { failure = error; }
    try {
      // Abort may race a completed rename. Establish the outcome from saved history before reporting it.
      const saved = await getSessionSnapshot(session.id);
      if (!saved || saved.agentId !== session.agentId) throw new Error('会话不存在或已删除');
      const committed = hasNewCompactionCheckpoint(session, saved);
      if (committed && notice) saved.messages = saved.messages.map(message =>
        message.type === 'compact-marker' && !session.messages.some(old => old.id === message.id)
          ? { ...message, compactionNotice: notice } : message);
      if (mounted.current && visible.current === `${session.agentId}:${session.id}`) options.apply(saved);
      publish({ ...fact, type: committed ? 'compact-done' : 'compact-failed', updatedAt: Math.max(Date.now(), updatedAt),
        aborted: !committed && controller.signal.aborted,
        ...(!committed && !controller.signal.aborted ? { message: failure instanceof Error ? failure.message
          : acknowledged ? t('compaction.status.unconfirmed') : String(failure ?? '') } : {}) });
    } catch (error) {
      publish({ ...fact, type: 'compact-failed', updatedAt: Math.max(Date.now(), updatedAt), message: t('compaction.status.unconfirmed') });
      console.warn('[chat] 压缩结果核对失败', error);
    } finally {
      pending.current.delete(session.id);
      if (mounted.current) setBusy(current => new Set([...current].filter(id => id !== session.id)));
    }
  };
  return { compactSession, compacting: !!options.sessionId && busy.has(options.sessionId),
    cancelCompaction: () => { if (options.sessionId) pending.current.get(options.sessionId)?.abort(); } };
}
