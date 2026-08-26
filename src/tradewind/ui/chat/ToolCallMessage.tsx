import { useState } from 'react';
import type { ChatMessage } from '../../../types';
import FileDiffCard, { parseFileEdit } from './FileDiffCard';
import { useLocale } from '../../../i18n/LocaleContext';

/**
 * ToolCallMessage — 信风工具调用卡片
 *
 * 对齐季风：avatar(🔧) + bubble 结构，嵌在消息流中。
 * 折叠时显示工具名 + 摘要，展开后显示参数和结果。
 */
export default function ToolCallMessage({ toolCall }: {
  toolCall: NonNullable<ChatMessage['toolCall']>;
}) {
  const { t } = useLocale();
  const [expanded, setExpanded] = useState(false);
  const fileEdit = parseFileEdit(toolCall);

  if (fileEdit) {
    return <FileDiffCard toolCall={toolCall} edit={fileEdit} />;
  }

  const resultLines = (toolCall.result || '').split('\n');
  const summary = resultLines.length > 1
    ? t('tradewind.chat.tools.lines', { count: resultLines.length })
    : (resultLines[0]?.slice(0, 60) || t('tradewind.chat.tools.noOutput'));

  return (
    <div className="tw-chat-row tw-chat-row--assistant">
      <div className="tw-chat-avatar tw-chat-avatar--tool">🔧</div>
      <div className="tw-chat-bubble" style={{ padding: 0, overflow: 'hidden' }}>
        <button
          className="tw-tool-card__header"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
        >
          <span className={`tw-tool-card__arrow${expanded ? ' tw-tool-card__arrow--open' : ''}`}>▶</span>
          <span className="tw-tool-card__name">{toolCall.toolName}</span>
          {toolCall.status === 'pending' && <span className="tw-tool-card__spinner" />}
          {!expanded && toolCall.result && (
            <span className="tw-tool-card__summary">{summary}</span>
          )}
        </button>
        {expanded && (
          <div className="tw-tool-card__body">
            {toolCall.params && Object.keys(toolCall.params).length > 0 && (
              <div>
                <div className="tw-tool-card__section-label">{t('tradewind.chat.tools.params')}</div>
                <pre className="tw-tool-card__pre">
                  {JSON.stringify(toolCall.params, null, 2)}
                </pre>
              </div>
            )}
            {toolCall.result && (
              <div>
                <div className="tw-tool-card__section-label">
                  {t('tradewind.chat.tools.result')}{toolCall.durationMs ? ` (${toolCall.durationMs}ms)` : ''} {toolCall.status === 'error' ? '✗' : '✓'}
                </div>
                <pre className="tw-tool-card__pre">
                  {toolCall.result}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
