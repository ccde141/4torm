import { useLocale } from '../../i18n/LocaleContext';

const statusKeys = {
  checking: 'chat.ask.checking', waiting: 'chat.ask.waiting',
  submitting: 'chat.ask.submitting', accepted: 'chat.ask.accepted',
  failed: 'chat.ask.failed', unknown: 'chat.ask.unknown', expired: 'chat.ask.expired',
} as const;

/**
 * AskCard — Agent 反问卡片
 *
 * 视觉特征：
 * - 左侧紫色竖条标识（区别于 delegate 绿/工具调用灰）
 * - 问题文本 + 可选预设按钮 + 对话框回答提示
 * - answered=true 后变为静态已回复状态
 */
export interface AskCardProps {
  question: string;
  options?: string[];
  answered: boolean;
  reply?: string;
  status?: 'checking' | 'waiting' | 'submitting' | 'accepted' | 'failed' | 'unknown' | 'expired';
  statusDetail?: string;
  onCheck?: () => void;
  onReply: (answer: string) => void;
}

export default function AskCard({ question, options, answered, reply, status, statusDetail,
  onCheck, onReply }: AskCardProps) {
  const { t } = useLocale();
  const blocked = status === 'checking' || status === 'submitting'
    || status === 'unknown' || status === 'expired' || status === 'accepted';

  const handleOptionClick = (opt: string) => {
    if (answered || blocked) return;
    onReply(opt);
  };

  return (
    <div className="chat__message chat__message--assistant">
      <div className="chat__bubble" style={{
        minWidth: '280px', maxWidth: '500px',
        border: '1px solid var(--glass-border)',
        borderLeft: '3px solid #8b5cf6',
        background: 'var(--glass-bg)',
        padding: '12px 16px',
      }}>
        {/* 问题文本 */}
        <div style={{ marginBottom: '10px', fontSize: 'var(--text-sm)', color: 'var(--color-text-primary)' }}>
          {question}
        </div>

        {answered ? (
          /* 已回复状态 */
          <div style={{
            padding: '6px 10px',
            background: 'var(--color-accent-subtle)',
            borderRadius: '6px',
            fontSize: 'var(--text-sm)',
            color: 'var(--color-accent)',
          }}>
            ✓ {reply}
          </div>
        ) : (
          /* 待回复状态 */
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {status && <div role={status === 'failed' ? 'alert' : 'status'} aria-live="polite"
              style={{ fontSize: 'var(--text-xs)', color: status === 'failed'
                ? 'var(--color-error)' : 'var(--color-text-secondary)' }}>
              {t(statusKeys[status])}{statusDetail ? `：${statusDetail}` : ''}
              {(status === 'unknown' || status === 'checking' || status === 'failed') && onCheck
                && <button type="button" onClick={onCheck}
                style={{ marginLeft: 8 }}>{t('chat.ask.checkAgain')}</button>}
            </div>}
            {/* 预设选项按钮 */}
            {options && options.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {options.map((opt, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => handleOptionClick(opt)}
                    disabled={blocked}
                    style={{
                      padding: '4px 12px',
                      borderRadius: '14px',
                      border: '1px solid var(--color-accent)',
                      background: 'transparent',
                      color: 'var(--color-accent)',
                      fontSize: 'var(--text-xs)',
                      cursor: 'pointer',
                      transition: 'background 0.15s',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-accent-subtle)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            )}

            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>
              {t('chat.ask.composerHint')}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
