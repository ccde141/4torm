import type { ToolCall } from '../../types';
import { useLocale } from '../../i18n/LocaleContext';

type Pending = NonNullable<ToolCall['pendingAutomation']>;

/**
 * 潮汐任务信息卡（纯展示，无按钮）。
 * AI 只能建/改「未启用」的任务；启用/暂停一律由用户在潮汐页操作。
 * 摘要字段全部来自服务端真实任务（非 AI 转述）；永续 / 自循环 / 可写文件强标提醒。
 */
export default function AutomationDraftCard({ pending, timestamp }: { pending: Pending; timestamp?: string }) {
  const { t } = useLocale();
  const verb = pending.mode === 'created' ? t('chat.automation.created') : t('chat.automation.updated');
  const repeatText = pending.perpetual ? t('chat.automation.perpetual') : t('chat.automation.repeatCount', { count: pending.repeatCount });

  return (
    <div style={wrap}>
      <div style={header}>
        <span style={{ fontSize: '15px' }}>📅</span>
        <span style={{ fontWeight: 'var(--font-semibold)', fontSize: 'var(--text-sm)' }}>{verb}</span>
        <span style={pill(pending.enabled)}>{pending.enabled ? t('chat.automation.running') : t('chat.automation.disabled')}</span>
        {timestamp && <span style={{ marginLeft: 'auto', fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-mono)' }}>{timestamp}</span>}
      </div>

      <div style={{ padding: 'var(--space-2) var(--space-3)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <Row k={t('chat.automation.name')} v={pending.name} />
        <Row k={t('chat.automation.interval')} v={pending.schedule} />
        <Row k={t('chat.automation.repeats')} v={repeatText} warn={pending.perpetual} />
        {pending.selfLoop && <Row k={t('chat.automation.selfLoop')} v={t('chat.automation.selfLoopValue')} warn />}
        <Row k={t('chat.automation.execution')} v={t('chat.automation.permission', { agent: pending.agentName })} />
        <Row k={t('chat.automation.files')} v={pending.canWriteFiles ? t('chat.automation.canWrite') : t('chat.automation.readOnly')} warn={pending.canWriteFiles} />
        <div style={promptBox}>{pending.promptPreview}</div>
      </div>

      <div style={footer}>
        {pending.enabled
          ? t('chat.automation.runningHint')
          : t('chat.automation.disabledHint')}
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
