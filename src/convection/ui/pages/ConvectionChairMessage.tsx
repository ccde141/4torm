import ReasoningBlock from '../../../components/chat/ReasoningBlock';
import { renderTextWithCode } from '../../../engine/markdown';
import { useLocale } from '../../../i18n/LocaleContext';
import { formatTimestamp } from '../../../utils/time';
import { convectionReasoningProps } from './convection-message-map';
import './convection-chair-message.css';

interface ChairMessage {
  role: string;
  content: string;
  streaming?: boolean;
  reasoning?: string;
  waitingInfo?: { phase: 'llm-waiting' | 'tool-exec'; elapsed: number };
  timestamp?: string;
}

/** Private meeting messages keep their presentation within Convection. */
export default function ConvectionChairMessage({ message, messageId, suppressWaiting = false }: {
  message: ChairMessage; messageId: string; suppressWaiting?: boolean;
}) {
  const { t } = useLocale();
  const kind = message.role === 'user' ? 'user' : 'assistant';
  const reasoning = convectionReasoningProps(message.reasoning, !!message.streaming);
  const waiting = message.streaming && !suppressWaiting ? message.waitingInfo : undefined;
  const separated = kind === 'assistant' && !!message.reasoning;
  return <div className={`conv__chair-msg conv__chair-msg--${kind} convection-chair-turn`}>
    <div className={`conv__chair-bubble conv__chair-bubble--${kind}`}>
      {reasoning && <ReasoningBlock {...reasoning} preview />}
      {waiting && <div className="conv__waiting-hint">
        {t('convection.turn.waitingModel')}
        <span className="conv__waiting-elapsed">{Math.round(waiting.elapsed / 1000)}s</span>
        <span className="thinking-card__tool-spinner" />
      </div>}
      {(message.content || (message.streaming && !message.waitingInfo && !suppressWaiting)) && (
        <div className={`convection-chair-turn__answer${separated ? ' convection-chair-turn__answer--separated' : ''}`}>
          {renderTextWithCode(message.content, messageId)}
          {message.streaming && !message.waitingInfo && !suppressWaiting ? '▍' : ''}
        </div>
      )}
      {message.timestamp && <div className="chat__timestamp" title={formatTimestamp(message.timestamp, true)}>
        {formatTimestamp(message.timestamp)}
      </div>}
    </div>
  </div>;
}
