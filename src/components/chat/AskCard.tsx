import { useState } from 'react';

/**
 * AskCard — Agent 反问卡片
 *
 * 视觉特征：
 * - 左侧紫色竖条标识（区别于 delegate 绿/工具调用灰）
 * - 问题文本 + 可选预设按钮 + 自由输入框
 * - answered=true 后变为静态已回复状态
 */
export interface AskCardProps {
  question: string;
  options?: string[];
  answered: boolean;
  reply?: string;
  onReply: (answer: string) => void;
}

export default function AskCard({ question, options, answered, reply, onReply }: AskCardProps) {
  const [customInput, setCustomInput] = useState('');

  const handleOptionClick = (opt: string) => {
    if (answered) return;
    onReply(opt);
  };

  const handleSubmit = () => {
    if (answered || !customInput.trim()) return;
    onReply(customInput.trim());
    setCustomInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
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
            {/* 预设选项按钮 */}
            {options && options.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {options.map((opt, i) => (
                  <button
                    key={i}
                    onClick={() => handleOptionClick(opt)}
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

            {/* 自由输入 */}
            <div style={{ display: 'flex', gap: '6px' }}>
              <input
                type="text"
                value={customInput}
                onChange={e => setCustomInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="自由输入..."
                style={{
                  flex: 1,
                  padding: '4px 8px',
                  borderRadius: '6px',
                  border: '1px solid var(--color-border)',
                  background: 'var(--glass-bg)',
                  color: 'var(--color-text-primary)',
                  fontSize: 'var(--text-sm)',
                  outline: 'none',
                }}
              />
              <button
                onClick={handleSubmit}
                disabled={!customInput.trim()}
                style={{
                  padding: '4px 10px',
                  borderRadius: '6px',
                  border: 'none',
                  background: customInput.trim() ? 'var(--color-accent)' : 'var(--color-border)',
                  color: customInput.trim() ? 'var(--color-on-accent)' : 'var(--color-text-tertiary)',
                  fontSize: 'var(--text-sm)',
                  cursor: customInput.trim() ? 'pointer' : 'default',
                }}
              >
                回复
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
