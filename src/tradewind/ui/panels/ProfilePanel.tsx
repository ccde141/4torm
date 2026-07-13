/**
 * 循环档案面板 —— 管理 AutoProfile + 兼作选档运行入口
 *
 * 由 Toolbar「自动运行」按钮触发显示（用户定：先开面板再选档）。
 * 每个档案带「运行」按钮 → onRun('auto', id)；顶部「不循环单圈」→ onRun('auto', undefined)。
 * 仿 WorkflowListPanel 的滑出面板 + fetch-on-visible + 整存整取模式。
 *
 * 本刀只做 relative 节拍（潮汐 absolute 已砍），故 UI 不暴露 cadence 类型选择。
 */

import { useState, useEffect, useCallback } from 'react';
import type { WorkflowMode } from '../../types';

interface AutoProfile {
  id: string;
  name: string;
  cadence: { kind: 'relative'; gapSec: number };
  overlap: 'skip' | 'queue';
  lapBound: number | null;
  carryOver: 'accumulate' | 'reset' | 'summary';
  loopNote?: string;
  summaryPrompt?: string;
}

interface ProfilePanelProps {
  visible: boolean;
  workflowId: string;
  onClose: () => void;
  onRun: (mode: WorkflowMode, profileId?: string) => void;
}

/** 新档案默认值：30s 间隔、永续、accumulate */
function blankProfile(): AutoProfile {
  return {
    id: `p-${Date.now().toString(36)}`,
    name: '新档案',
    cadence: { kind: 'relative', gapSec: 30 },
    overlap: 'skip',
    lapBound: null,
    carryOver: 'accumulate',
  };
}

export function ProfilePanel({ visible, workflowId, onClose, onRun }: ProfilePanelProps) {
  const [profiles, setProfiles] = useState<AutoProfile[]>([]);
  const [editing, setEditing] = useState<AutoProfile | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!workflowId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/tradewind/workflow/${workflowId}/profiles`);
      if (res.ok) {
        const data = await res.json() as { profiles: AutoProfile[] };
        setProfiles(data.profiles ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [workflowId]);

  useEffect(() => {
    if (visible) { refresh(); setEditing(null); }
  }, [visible, refresh]);

  // 整存：把当前 profiles 数组覆盖写回后端
  const persist = useCallback(async (next: AutoProfile[]) => {
    setProfiles(next);
    await fetch(`/api/tradewind/workflow/${workflowId}/profiles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profiles: next }),
    });
  }, [workflowId]);

  const saveEdited = useCallback(async (p: AutoProfile) => {
    const idx = profiles.findIndex(x => x.id === p.id);
    const next = idx >= 0
      ? profiles.map(x => x.id === p.id ? p : x)
      : [...profiles, p];
    await persist(next);
    setEditing(null);
  }, [profiles, persist]);

  const remove = useCallback(async (id: string) => {
    await fetch(`/api/tradewind/workflow/${workflowId}/profiles/${id}`, { method: 'DELETE' });
    setProfiles(prev => prev.filter(p => p.id !== id));
  }, [workflowId]);

  if (!visible) return null;

  return (
    <div className="tw-profile mo-slide-in-left">
      <div className="tw-profile__header">
        <span className="tw-profile__title">循环档案 · 自动运行</span>
        <button className="tw-profile__close" onClick={onClose}>×</button>
      </div>
      <div className="tw-profile__body">
        {editing
          ? <ProfileForm draft={editing} onChange={setEditing} onSave={saveEdited} onCancel={() => setEditing(null)} />
          : <ProfileList
              profiles={profiles} loading={loading}
              onRun={onRun} onClose={onClose}
              onNew={() => setEditing(blankProfile())}
              onEdit={setEditing} onDelete={remove}
            />}
      </div>
    </div>
  );
}

interface ProfileListProps {
  profiles: AutoProfile[];
  loading: boolean;
  onRun: (mode: WorkflowMode, profileId?: string) => void;
  onClose: () => void;
  onNew: () => void;
  onEdit: (p: AutoProfile) => void;
  onDelete: (id: string) => void;
}

function ProfileList({ profiles, loading, onRun, onClose, onNew, onEdit, onDelete }: ProfileListProps) {
  return (
    <>
      <button
        className="tw-profile__single"
        onClick={() => { onRun('auto', undefined); onClose(); }}
        title="自动模式跑一趟就停，不循环"
      >⚡ 不循环 · 单圈自动运行</button>

      <button className="tw-profile__new" onClick={onNew}>+ 新建循环档案</button>

      {loading && <div className="tw-profile__hint">加载中...</div>}
      {!loading && profiles.length === 0 && (
        <div className="tw-profile__hint">暂无循环档案</div>
      )}
      {profiles.map((p) => (
        <div key={p.id} className="tw-profile__item">
          <div className="tw-profile__item-main">
            <span className="tw-profile__item-name">{p.name}</span>
            <span className="tw-profile__item-meta">
              每 {p.cadence.gapSec}s · {p.lapBound === null ? '永续' : `${p.lapBound} 圈`}
              {' · '}{p.carryOver === 'accumulate' ? '累积' : '重置'}
            </span>
          </div>
          <div className="tw-profile__item-actions">
            <button
              className="tw-profile__item-run"
              onClick={() => { onRun('auto', p.id); onClose(); }}
              title="用此档案循环运行"
            >▶ 运行</button>
            <button className="tw-profile__item-edit" onClick={() => onEdit(p)} title="编辑">✎</button>
            <button className="tw-profile__item-del" onClick={() => onDelete(p.id)} title="删除">✕</button>
          </div>
        </div>
      ))}
    </>
  );
}

interface ProfileFormProps {
  draft: AutoProfile;
  onChange: (p: AutoProfile) => void;
  onSave: (p: AutoProfile) => void;
  onCancel: () => void;
}

function ProfileForm({ draft, onChange, onSave, onCancel }: ProfileFormProps) {
  const perpetual = draft.lapBound === null;
  return (
    <div className="tw-profile__form">
      <label className="tw-profile__field">
        <span>名称</span>
        <input
          value={draft.name}
          onChange={(e) => onChange({ ...draft, name: e.target.value })}
        />
      </label>

      <label className="tw-profile__field">
        <span>圈间延时（秒）</span>
        <input
          type="number" min={0} value={draft.cadence.gapSec}
          onChange={(e) => onChange({ ...draft, cadence: { kind: 'relative', gapSec: Math.max(0, Number(e.target.value) || 0) } })}
        />
      </label>

      <label className="tw-profile__field tw-profile__field--row">
        <input
          type="checkbox" checked={perpetual}
          onChange={(e) => onChange({ ...draft, lapBound: e.target.checked ? null : 5 })}
        />
        <span>永续（不限圈数）</span>
      </label>
      {!perpetual && (
        <label className="tw-profile__field">
          <span>圈数上界</span>
          <input
            type="number" min={1} value={draft.lapBound ?? 1}
            onChange={(e) => onChange({ ...draft, lapBound: Math.max(1, Number(e.target.value) || 1) })}
          />
        </label>
      )}

      <label className="tw-profile__field">
        <span>结转（圈与圈之间传什么）</span>
        <select
          value={draft.carryOver}
          onChange={(e) => onChange({ ...draft, carryOver: e.target.value as 'accumulate' | 'reset' | 'summary' })}
        >
          <option value="accumulate">累积 · 下圈 = 任务种子 + 上圈产出（滚雪球，逐圈精炼）</option>
          <option value="reset">重置 · 下圈 = 任务种子（丢弃上圈产出，各圈独立）</option>
          <option value="summary">摘要 · 下圈 = 任务种子 + 上圈产出的必要摘要（LLM 压缩）</option>
        </select>
        <small className="tw-profile__hint">
          区别在下圈带上圈产出的形态：全文 / 不带 / 压缩摘要。摘要失败自动降级为带全文。
        </small>
      </label>

      {draft.carryOver === 'summary' && (
        <label className="tw-profile__field">
          <span>摘要指令（可空，喂给摘要 LLM 的 system prompt）</span>
          <textarea
            rows={3} value={draft.summaryPrompt ?? ''}
            placeholder="留空则用内置默认：保留关键结论、产出物路径、未完成项、下轮注意事项，丢弃冗长正文"
            onChange={(e) => onChange({ ...draft, summaryPrompt: e.target.value || undefined })}
          />
        </label>
      )}

      <label className="tw-profile__field">
        <span>循环备注（框定语，可空）</span>
        <textarea
          rows={3} value={draft.loopNote ?? ''}
          onChange={(e) => onChange({ ...draft, loopNote: e.target.value || undefined })}
        />
      </label>

      <div className="tw-profile__form-actions">
        <button className="tw-profile__save" onClick={() => onSave(draft)} disabled={!draft.name.trim()}>保存</button>
        <button className="tw-profile__cancel" onClick={onCancel}>取消</button>
      </div>
    </div>
  );
}
