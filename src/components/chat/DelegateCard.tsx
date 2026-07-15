import { useState } from 'react';
import type { ChatMessage } from '../../types';
import { formatTimestamp } from '../../utils/time';

type Step = { type: 'tool' | 'thought'; tool?: string; args?: Record<string, string>; result?: string; ok?: boolean; text?: string };

/**
 * DelegateCard — SubAgent 委托任务的折叠卡片
 *
 * 视觉特征：
 * - 左侧彩色竖条标识（区别于普通工具调用）
 * - 缩进展示（表示层级关系）
 * - 折叠时：任务摘要 + 步骤计数 + 状态
 * - 展开后：结构化步骤列表 + 最终结果
 */
export default function DelegateCard({ toolCall, content, actions, timestamp }: {
  toolCall: NonNullable<ChatMessage['toolCall']> & { steps?: Step[] };
  content?: string;
  actions?: React.ReactNode;
  timestamp?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const task = String(toolCall.params?.task ?? '子任务');
  const status = toolCall.status;
  const summary = toolCall.result || '';
  const steps: Step[] = (toolCall as any).steps || [];
  const durationMs = toolCall.durationMs || 0;

  const statusConfig = {
    success: { icon: '\u2713', color: '#22c55e', label: '完成' },
    error: { icon: '\u2717', color: '#ef4444', label: '失败' },
    running: { icon: '\u25cc', color: '#eab308', label: '执行中' },
  } as Record<string, { icon: string; color: string; label: string }>;

  const st = statusConfig[status || 'running'] || statusConfig.running;
  const taskBrief = task.length > 60 ? task.slice(0, 60) + '\u2026' : task;
  const toolSteps = steps.filter(s => s.type === 'tool');
  const durationStr = durationMs > 0 ? `${(durationMs / 1000).toFixed(1)}s` : '';

  // 折叠时的副标题
  const subtitle = status === 'running'
    ? (toolSteps.length > 0 ? `${toolSteps.length} 步工具调用中...` : '思考中...')
    : (durationStr ? `${toolSteps.length} 步 · ${durationStr}` : `${toolSteps.length} 步`);

  return (
    <div className="chat__message chat__message--assistant chat__message--tool" style={{ paddingLeft: '24px' }}>
      <div className="chat__bubble" style={{
        minWidth: '280px', maxWidth: '600px',
        border: `1px solid var(--glass-border)`,
        borderLeft: `3px solid ${st.color}`,
        background: 'var(--glass-bg)',
        backdropFilter: 'blur(var(--glass-blur))',
        borderRadius: 'var(--border-radius-md)',
        padding: 0, overflow: 'hidden',
      }}>
        {/* 头部 */}
        <button onClick={() => setExpanded(!expanded)} aria-expanded={expanded} style={{
          display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
          cursor: 'pointer', userSelect: 'none',
          appearance: 'none', border: 'none', background: 'none',
          font: 'inherit', color: 'inherit',
          padding: 'var(--space-3) var(--space-4)', width: '100%', textAlign: 'left',
        }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: '20px', height: '20px', borderRadius: '50%',
            background: `${st.color}20`, color: st.color,
            fontSize: '11px', fontWeight: 'bold', flexShrink: 0,
          }}>
            {status === 'running'
              ? <span style={{ animation: 'spin 1.5s linear infinite' }}>{st.icon}</span>
              : st.icon}
          </span>
          <span style={{ flex: 1, fontSize: 'var(--text-sm)', color: 'var(--color-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {taskBrief}
          </span>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', marginRight: 'var(--space-2)' }}>
            {subtitle}
          </span>
          <span style={{ fontSize: '10px', color: 'var(--color-text-tertiary)', transition: 'transform 0.2s', transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>
            {'\u25b6'}
          </span>
        </button>

        {/* 折叠时：最后一个工具调用或结果摘要 */}
        {!expanded && status === 'running' && toolSteps.length > 0 && (
          <div style={{ padding: '0 var(--space-4) var(--space-3)', fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-mono)' }}>
            {toolSteps[toolSteps.length - 1].tool}{toolSteps[toolSteps.length - 1].result ? ' \u2713' : ' ...'}
          </div>
        )}
        {!expanded && status !== 'running' && summary && (
          <div style={{ padding: '0 var(--space-4) var(--space-3)', fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {summary.slice(0, 120)}{summary.length > 120 ? '\u2026' : ''}
          </div>
        )}

        {/* 展开后 */}
        {expanded && (
          <div style={{ padding: '0 var(--space-4) var(--space-3)', borderTop: '1px solid var(--border-color)' }}>
            {/* 任务 */}
            <div style={{ marginTop: 'var(--space-2)' }}>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', marginBottom: '2px' }}>任务</div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', lineHeight: '1.5' }}>{task}</div>
            </div>
            {/* 步骤列表 */}
            {toolSteps.length > 0 && (
              <div style={{ marginTop: 'var(--space-2)' }}>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', marginBottom: '4px' }}>执行步骤</div>
                {toolSteps.map((s, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: '6px', fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', padding: '2px 0', color: s.ok === false ? '#ef4444' : 'var(--color-text-secondary)' }}>
                    <span style={{ color: s.result != null ? (s.ok ? '#22c55e' : '#ef4444') : '#eab308', flexShrink: 0 }}>
                      {s.result != null ? (s.ok ? '\u2713' : '\u2717') : '\u25cc'}
                    </span>
                    <span>{s.tool}</span>
                    {s.result && <span style={{ color: 'var(--color-text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '300px' }}>
                      {s.result.slice(0, 60)}
                    </span>}
                  </div>
                ))}
              </div>
            )}
            {/* 思考过程 */}
            {content && (
              <div style={{ marginTop: 'var(--space-2)' }}>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', marginBottom: '2px' }}>思考过程</div>
                <pre style={{ margin: 0, padding: 'var(--space-2)', background: 'var(--color-bg)', borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap', maxHeight: '200px', overflow: 'auto' }}>{content}</pre>
              </div>
            )}
            {/* 最终结果 */}
            {summary && (
              <div style={{ marginTop: 'var(--space-2)' }}>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', marginBottom: '2px' }}>结果 {st.icon}</div>
                <pre style={{ margin: 0, padding: 'var(--space-2)', background: 'var(--color-bg)', borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap', maxHeight: '300px', overflow: 'auto' }}>{summary}</pre>
              </div>
            )}
          </div>
        )}

        {actions && (
          <div style={{ padding: '0 var(--space-4) var(--space-2)', display: 'flex', justifyContent: 'flex-end' }}>
            {actions}
          </div>
        )}
        {timestamp && <div className="chat__timestamp" style={{ padding: '0 var(--space-4) var(--space-2)' }} title={formatTimestamp(timestamp, true)}>{formatTimestamp(timestamp)}</div>}
      </div>
    </div>
  );
}
