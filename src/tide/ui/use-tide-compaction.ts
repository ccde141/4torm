import { useEffect, useRef, useState } from 'react';
import { compactTideSession, getTideSession, type TideSession } from '../../api/tide';
import { compactionActivity, latestCompactionActivity, type CompactionActivity } from '../../components/common/compaction-activity';

export function useTideCompaction(session: TideSession, onCompacted: (() => Promise<unknown>) | undefined,
  english: boolean) {
  const identity = `${session.agentId}:${session.id}`;
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;
  const pending = useRef<AbortController | undefined>(undefined);
  const mounted = useRef(true);
  const [local, setLocal] = useState<CompactionActivity>();
  const [notice, setNotice] = useState('');
  const [compacting, setCompacting] = useState(false);
  useEffect(() => {
    mounted.current = true;
    setLocal(undefined); setNotice(''); setCompacting(false);
    // Closing a view drops its subscription; only explicit Stop cancels the admitted request.
    return () => { mounted.current = false; pending.current = undefined; };
  }, [identity]);
  const compact = async () => {
    if (pending.current) return;
    const controller = new AbortController(); pending.current = controller;
    const startedAt = Date.now();
    const activity: CompactionActivity = { id: `pending-tide-${startedAt}`, operation: 'compact',
      phase: 'running', startedAt, updatedAt: startedAt };
    const current = () => mounted.current && currentIdentity.current === identity && pending.current === controller;
    setLocal(activity); setNotice(''); setCompacting(true);
    try {
      const result = await compactTideSession(session.agentId, session.id, controller.signal);
      if (!current()) return;
      setNotice(result.notices.join('\n'));
      setLocal({ ...activity, phase: 'completed', updatedAt: result.updatedAt });
      await onCompacted?.().catch(() => undefined);
    } catch (cause) {
      if (!current()) return;
      if (controller.signal.aborted) {
        // A disconnected response can follow a successful commit. Reread before describing it.
        const saved = await getTideSession(session.agentId, session.id).catch(() => undefined);
        if (!current()) return;
        const committed = saved?.messages.some(message => message.type === 'compact-marker'
          && !session.messages.some(original => original.id === message.id));
        setLocal({ ...activity, phase: committed ? 'completed' : 'failed', updatedAt: Date.now(),
          message: committed ? undefined : !saved ? english
            ? 'Compaction result could not be confirmed. Reopen this conversation to check.' : '压缩结果尚未确认，请重新打开会话核对'
            : english ? 'Request stopped; showing the saved conversation.' : '请求已中止，当前显示已保存的会话' });
        await onCompacted?.().catch(() => undefined);
      } else setLocal({ ...activity, phase: 'failed', updatedAt: Date.now(),
        message: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      if (current()) { pending.current = undefined; setCompacting(false); }
    }
  };
  const stored = compactionActivity(session.compaction);
  return { compact, cancel: () => pending.current?.abort(), compacting, notice,
    activity: latestCompactionActivity(local, stored) };
}
