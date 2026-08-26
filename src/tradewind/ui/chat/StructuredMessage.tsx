import { useState, type ReactNode } from 'react';
import { useLocale } from '../../../i18n/LocaleContext';

interface ToolStep {
  tool: string;
  args: Record<string, string>;
  result?: string;
  status: 'pending' | 'running' | 'done' | 'error';
}

interface Props {
  think: string;
  tools: ToolStep[];
  answer: string;
  note: string;
  msgId: string;
  onDelete?: () => void;
  actions?: ReactNode;
}

/**
 * StructuredMessage — 信风会话中的结构化消息
 *
 * 包含 think / tools / answer / note 四段。
 * 全部使用 tw-* 类系统，零内联样式。
 */
export default function StructuredMessage({ think, tools, answer, note, actions }: Props) {
  const { t } = useLocale();
  const [showThink, setShowThink] = useState(false);
  const [showTool, setShowTool] = useState<Record<number, boolean>>({});

  const toggleTool = (idx: number) => {
    setShowTool(prev => ({ ...prev, [idx]: !prev[idx] }));
  };

  return (
    <div className="tw-chat-row tw-chat-row--assistant">
      <div className="tw-chat-avatar tw-chat-avatar--assistant">AI</div>
      <div className="tw-chat-bubble tw-stmsg">
        {/* 思考过程 */}
        {think && (
          <div className="tw-meeting-think">
            <button
              className="tw-meeting-think__trigger"
              onClick={() => setShowThink(!showThink)}
              aria-expanded={showThink}
            >
              <span className="tw-meeting-think__arrow">{showThink ? '▼' : '▶'}</span>
              <span className="tw-meeting-think__label">{t('tradewind.chat.reasoning.title')}</span>
            </button>
            {showThink && (
              <div className="tw-meeting-think__body">{think}</div>
            )}
          </div>
        )}

        {/* 工具调用 */}
        {tools.map((toolStep, i) => {
          const statusMod = toolStep.status === 'pending' || toolStep.status === 'running' ? 'pending'
            : toolStep.status === 'error' ? 'error' : 'success';
          const icon = toolStep.status === 'running' ? null
            : toolStep.status === 'done' ? '✓'
            : toolStep.status === 'error' ? '✗' : '◌';
          const opened = showTool[i] ?? false;
          return (
            <div key={i} className={`tw-tool-card tw-tool-card--${statusMod}`}>
              <button
                className="tw-tool-card__header"
                onClick={() => toggleTool(i)}
                aria-expanded={opened}
              >
                <span className={`tw-tool-card__arrow${opened ? ' tw-tool-card__arrow--open' : ''}`}>
                  ▶
                </span>
                <span className="tw-tool-card__name">{toolStep.tool}</span>
                {toolStep.status === 'running' ? <span className="tw-tool-card__spinner" /> : (
                  <span className={`tw-tool-card__step-icon tw-tool-card__step-icon--${statusMod === 'success' ? 'done' : statusMod}`}>{icon}</span>
                )}
              </button>
              {opened && (
                <div className="tw-tool-card__body">
                  <div>
                    <div className="tw-tool-card__section-label">{t('tradewind.chat.tools.params')}</div>
                    <pre className="tw-tool-card__pre">{JSON.stringify(toolStep.args, null, 2)}</pre>
                  </div>
                  {toolStep.result && (
                    <div>
                      <div className="tw-tool-card__section-label">{t('tradewind.chat.tools.result')}</div>
                      <pre className="tw-tool-card__pre">{toolStep.result}</pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* 最终回答 */}
        {answer && <div className="tw-stmsg__answer">{answer}</div>}

        {/* 提醒 */}
        {note && (
          <div className="tw-meeting-note">
            <div className="tw-meeting-note__header">{t('tradewind.chat.structured.note')}</div>
            <div className="tw-meeting-note__body">{note}</div>
          </div>
        )}

        {actions && <div className="tw-stmsg__actions">{actions}</div>}
      </div>
    </div>
  );
}
