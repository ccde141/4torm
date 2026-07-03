import type { ToolCall } from '../../types';

type Pending = NonNullable<ToolCall['pendingAutomation']>;

/**
 * 潮汐任务信息卡（纯展示，无按钮）。
 * AI 只能建/改「未启用」的任务；启用/暂停一律由用户在潮汐页操作。
 * 摘要字段全部来自服务端真实任务（非 AI 转述）；永续 / 自循环 / 可写文件强标提醒。
 */
export default function AutomationDraftCard({ pending, timestamp }: { pending: Pending; timestamp?: string }) {
  const verb = pending.mode === 'created' ? '已写好潮汐任务' : '已修改潮汐任务';
  const repeatText = pending.perpetual ? '永续（不会自己停）' : `${pending.repeatCount} 次`;

  return (
    <div style={wrap}>
      <div style={header}>
        <span style={{ fontSize: '15px' }}>📅</span>
        <span style={{ fontWeight: 'var(--font-semibold)', fontSize: 'var(--text-sm)' }}>{verb}</span>
        <span style={pill(pending.enabled)}>{pending.enabled ? '运行中' : '未启用'}</span>
        {timestamp && <span style={{ marginLeft: 'auto', fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-mono)' }}>{timestamp}</span>}
      </div>

      <div style={{ padding: 'var(--space-2) var(--space-3)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <Row k="名称" v={pending.name} />
        <Row k="间隔" v={pending.schedule} />
        <Row k="次数" v={repeatText} warn={pending.perpetual} />
        {pending.selfLoop && <Row k="自循环" v="每轮会自改下轮目标" warn />}
        <Row k="执行" v={`${pending.agentName} · 沙箱 ${pending.sandboxLevel}`} />
        <Row k="文件" v={pending.canWriteFiles ? '⚠️ 该 Agent 可写/改文件' : '只读（无写文件工具）'} warn={pending.canWriteFiles} />
        <div style={promptBox}>{pending.promptPreview}</div>
      </div>

      <div style={footer}>
        {pending.enabled
          ? '任务已在运行。可在潮汐页暂停或调整。'
          : '此任务尚未启用 —— 请到潮汐页审阅后手动启用。'}
      </div>
    </div>
  );
}

function Row({ k, v, warn }: { k: string; v: string; warn?: boolean }) {
  return (
    <div style={{ display: 'flex', gap: 'var(--space-2)', fontSize: 'var(--text-sm)' }}>
      <span style={{ width: 40, flexShrink: 0, color: 'var(--color-text-tertiary)' }}>{k}</span>
      <span style={{ color: warn ? 'var(--color-error)' : 'var(--color-text-primary)', fontWeight: warn ? 'var(--font-semibold)' : 'var(--font-normal)', wordBreak: 'break-word' }}>{v}</span>
    </div>
  );
}

const wrap: React.CSSProperties = { margin: 'var(--space-2) 0', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-accent)', background: 'var(--glass-bg-soft)', overflow: 'hidden' };
const header: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: 'var(--space-2) var(--space-3)', borderBottom: '1px solid var(--border-color)' };
const footer: React.CSSProperties = { padding: 'var(--space-2) var(--space-3)', borderTop: '1px solid var(--border-color)', fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' };
const promptBox: React.CSSProperties = { marginTop: '4px', fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', background: 'var(--color-bg)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', padding: 'var(--space-2)' };
const pill = (on: boolean): React.CSSProperties => ({
  fontSize: '10px', padding: '1px 6px', borderRadius: 'var(--radius-full)',
  border: `1px solid ${on ? 'var(--color-success)' : 'var(--color-text-tertiary)'}`,
  color: on ? 'var(--color-success)' : 'var(--color-text-tertiary)',
});
