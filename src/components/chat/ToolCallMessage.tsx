import { useState } from 'react';
import type { ChatMessage } from '../../types';
import { formatTimestamp } from '../../utils/time';
import FileDiffCard, { parseFileEdit } from './FileDiffCard';
import { useLocale } from '../../i18n/LocaleContext';
import { isTeamTool, TeamToolMessage } from './team/TeamToolMessage';

export default function ToolCallMessage({ toolCall, actions, timestamp, interrupted }: {
  interrupted?: boolean;
  toolCall: NonNullable<ChatMessage['toolCall']>;
  actions?: React.ReactNode;
  timestamp?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const { t, locale } = useLocale();
  const isRunning = !interrupted && (toolCall.status === 'pending' || toolCall.status === 'running');
  if (isTeamTool(toolCall.toolName)) return <TeamToolMessage toolCall={toolCall} actions={actions} timestamp={timestamp} interrupted={interrupted} />;

  // 文件改动类工具（edit_file / write_file）渲染成 diff 卡片，直观展示 AI 改了什么
  const fileEdit = parseFileEdit(toolCall);
  if (fileEdit && !interrupted) {
    return <FileDiffCard toolCall={toolCall} edit={fileEdit} actions={actions} timestamp={timestamp} />;
  }

  const resultLines = (toolCall.result || '').split('\n');
  const summary = resultLines.length > 1
    ? t('chat.tool.lineCount', { count: resultLines.length })
    : (resultLines[0]?.slice(0, 60) || t('chat.tool.noOutput'));

  return (
    <div className="chat__message chat__message--assistant chat__message--tool">
      <div className="chat__avatar" style={{ background: 'var(--color-accent)', color: 'var(--color-on-accent)' }}>🔧</div>
      <div className={`chat__bubble${isRunning ? ' chat__tool-running' : ''}`} style={{ minWidth: '200px' }}>
        <button
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', cursor: 'pointer', userSelect: 'none', appearance: 'none', border: 'none', background: 'none', font: 'inherit', color: 'inherit', padding: 0, width: '100%', textAlign: 'left' }}
        >
          <span style={{ fontSize: '10px', transition: 'transform 0.2s', transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)', fontWeight: 'var(--font-semibold)', color: 'var(--color-accent)' }}>
            {toolCall.toolName}
          </span>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)' }}>
            {interrupted ? (locale === 'en-US' ? 'Stopped before a result was received' : '停止时尚未收到结果')
              : isRunning ? t('chat.tool.runningShort') : (!expanded && toolCall.result ? summary : '')}
          </span>
        </button>
        {expanded && (
          <div style={{ marginTop: 'var(--space-2)', paddingTop: 'var(--space-2)', borderTop: '1px solid var(--border-color)' }}>
            {toolCall.params && Object.keys(toolCall.params).length > 0 && (
              <div style={{ marginBottom: 'var(--space-2)' }}>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', marginBottom: '2px' }}>{t('chat.tool.params')}</div>
                <pre style={{ margin: 0, padding: 'var(--space-2)', background: 'var(--color-bg)', borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap', maxHeight: '100px', overflow: 'auto' }}>
                  {JSON.stringify(toolCall.params, null, 2)}
                </pre>
              </div>
            )}
            {toolCall.result && (
              <div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', marginBottom: '2px' }}>
                  {t('chat.tool.result')} {toolCall.durationMs ? `(${toolCall.durationMs}ms)` : ''} {toolCall.status === 'error' ? '❌' : '✅'}
                </div>
                <pre style={{ margin: 0, padding: 'var(--space-2)', background: 'var(--color-bg)', borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap', maxHeight: '200px', overflow: 'auto' }}>
                  {toolCall.result || `(${t('chat.tool.noOutput')})`}
                </pre>
              </div>
            )}
          </div>
        )}
        {actions && (
          <div className="chat__bubble-actions" style={{ marginTop: 'var(--space-1)' }}>
            {actions}
          </div>
        )}
        {timestamp && <div className="chat__timestamp" title={formatTimestamp(timestamp, true)}>{formatTimestamp(timestamp)}</div>}
      </div>
    </div>
  );
}
