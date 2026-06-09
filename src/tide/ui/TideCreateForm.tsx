/**
 * 潮汐 — 新建任务表单
 */

import { useState, useEffect } from 'react';
import { createTask, type CreateTaskInput, type TidePushMode } from '../../api/tide';
import { getSessionsByAgent } from '../../store/chat';
import { inputStyle, actionBtnStyle } from './tide-styles';

interface CreateFormProps {
  agentId: string;
  onDone: () => void;
  onCancel: () => void;
}

interface SessionOpt { id: string; title: string; }

export default function CreateForm({ agentId, onDone, onCancel }: CreateFormProps) {
  const [name, setName] = useState('');
  const [scheduleH, setScheduleH] = useState(0);
  const [scheduleM, setScheduleM] = useState(5);
  const [scheduleS, setScheduleS] = useState(0);
  const [prompt, setPrompt] = useState('');
  const [repeatCount, setRepeatCount] = useState(-1);
  const [pushMode, setPushMode] = useState<TidePushMode>('accumulate');
  const [windowN, setWindowN] = useState(1);
  const [targetSessionId, setTargetSessionId] = useState('');
  const [selfLoop, setSelfLoop] = useState(false);
  const [sessions, setSessions] = useState<SessionOpt[]>([]);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // designated 模式：拉当前 agent 的季风会话
  useEffect(() => {
    if (pushMode !== 'designated' || !agentId) return;
    getSessionsByAgent(agentId).then(list =>
      setSessions(list.map(s => ({ id: s.id, title: s.title || s.id })))
    );
  }, [pushMode, agentId]);

  const validateN = (n: number): string | null => {
    if (!Number.isInteger(n) || n < 1) return 'N 必须是 ≥1 的整数';
    if (n >= 2 && n % 2 !== 0) return 'N ≥2 时必须为偶数';
    return null;
  };

  const submit = async () => {
    setError('');
    if (!name.trim() || !prompt.trim()) {
      setError('名称和 prompt 必填');
      return;
    }
    if (!agentId) { setError('请先选择一个 Agent'); return; }
    if (pushMode === 'accumulate' && !selfLoop) {
      const nErr = validateN(windowN);
      if (nErr) { setError(nErr); return; }
    }
    if (pushMode === 'designated' && !targetSessionId) {
      setError('请选择一个目标季风会话'); return;
    }
    if (scheduleH < 0 || scheduleM < 0 || scheduleM > 59 || scheduleS < 0 || scheduleS > 59) {
      setError('分/秒 必须在 0-59 范围'); return;
    }
    if (scheduleH === 0 && scheduleM === 0 && scheduleS === 0) {
      setError('间隔至少填一项'); return;
    }
    const schedule = `every ${scheduleH}h${scheduleM}m${scheduleS}s`;
    setSubmitting(true);
    try {
      const input: CreateTaskInput = {
        name: name.trim(),
        schedule,
        prompt: prompt.trim(),
        agentId,
        repeatCount,
        pushMode,
        windowN,
        selfLoop,
        targetSessionId: pushMode === 'designated' ? targetSessionId : undefined,
      };
      await createTask(input);
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ marginTop: 'var(--space-2)', padding: 'var(--space-3)', background: 'var(--glass-bg)', backdropFilter: 'blur(var(--glass-blur))', WebkitBackdropFilter: 'blur(var(--glass-blur))', border: '1px solid var(--glass-border)', borderRadius: 'var(--border-radius-md)' }}>
      <input
        placeholder="任务名"
        value={name}
        onChange={e => setName(e.target.value)}
        style={inputStyle}
      />
      <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', whiteSpace: 'nowrap' }}>间隔</span>
        <input type="number" min={0} value={scheduleH} onChange={e => setScheduleH(parseInt(e.target.value, 10) || 0)}
          style={{ ...inputStyle, width: '56px', marginBottom: 0 }} />
        <span style={{ fontSize: '10px', color: 'var(--color-text-tertiary)' }}>时</span>
        <input type="number" min={0} max={59} value={scheduleM} onChange={e => setScheduleM(parseInt(e.target.value, 10) || 0)}
          style={{ ...inputStyle, width: '56px', marginBottom: 0 }} />
        <span style={{ fontSize: '10px', color: 'var(--color-text-tertiary)' }}>分</span>
        <input type="number" min={0} max={59} value={scheduleS} onChange={e => setScheduleS(parseInt(e.target.value, 10) || 0)}
          style={{ ...inputStyle, width: '56px', marginBottom: 0 }} />
        <span style={{ fontSize: '10px', color: 'var(--color-text-tertiary)' }}>秒</span>
      </div>
      <textarea
        placeholder="每次推送的消息内容"
        value={prompt}
        onChange={e => setPrompt(e.target.value)}
        rows={3}
        style={{ ...inputStyle, fontFamily: 'inherit', resize: 'vertical' }}
      />

      {/* self-loop 勾选 */}
      <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-2)', fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>
        <input type="checkbox" checked={selfLoop} onChange={e => setSelfLoop(e.target.checked)} />
        自循环模式（锁定累积 + N=2，agent 自己交出下一轮任务）
      </label>

      {/* 推送模式：self-loop 时禁用 */}
      <div style={{ marginBottom: 'var(--space-2)' }}>
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', display: 'block', marginBottom: '4px' }}>推送目标</span>
        <select
          value={selfLoop ? 'accumulate' : pushMode}
          disabled={selfLoop}
          onChange={e => setPushMode(e.target.value as TidePushMode)}
          style={{ ...inputStyle, marginBottom: 0 }}
        >
          <option value="accumulate">累积潮汐会话（滚动 + 归档）</option>
          <option value="designated">指定季风会话（裸 append）</option>
        </select>
      </div>

      {/* accumulate + 非 self-loop：N 输入 */}
      {pushMode === 'accumulate' && !selfLoop && (
        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)' }}>保留轮数 N</span>
          <input
            type="number" min={1} step={1}
            value={windowN}
            onChange={e => setWindowN(parseInt(e.target.value, 10) || 1)}
            style={{ ...inputStyle, width: '70px', marginBottom: 0 }}
          />
           <span style={{ fontSize: '10px', color: 'var(--color-text-tertiary)' }}>(1=每轮独立归档；≥2 偶数滚动)</span>
        </div>
      )}

      {/* designated：会话下拉 */}
      {pushMode === 'designated' && !selfLoop && (
        <select
          value={targetSessionId}
          onChange={e => setTargetSessionId(e.target.value)}
          style={inputStyle}
        >
          <option value="">— 选择目标季风会话 —</option>
          {sessions.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
        </select>
      )}

      <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)' }}>重复</span>
        <input
          type="number"
          value={repeatCount}
          onChange={e => setRepeatCount(parseInt(e.target.value, 10) || -1)}
          style={{ ...inputStyle, width: '60px', marginBottom: 0 }}
        />
        <span style={{ fontSize: '10px', color: 'var(--color-text-tertiary)' }}>(-1 永续)</span>
      </div>
      {error && <div style={{ color: '#ef4444', fontSize: 'var(--text-xs)', marginBottom: 'var(--space-2)' }}>{error}</div>}
      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <button onClick={submit} disabled={submitting} style={{ ...actionBtnStyle, color: 'var(--color-accent)' }}>
          {submitting ? '创建中…' : '创建'}
        </button>
        <button onClick={onCancel} style={actionBtnStyle}>取消</button>
      </div>
    </div>
  );
}
