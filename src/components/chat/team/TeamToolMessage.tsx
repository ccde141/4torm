import type { ChatMessage } from '../../../types';
import { useLocale } from '../../../i18n/LocaleContext';
import { formatTimestamp } from '../../../utils/time';
import './team.css';
const titles: Record<string, [string, string]> = {
  team_create: ['创建协作成员', 'Create teammate'], team_dispatch: ['向成员分配工作', 'Assign work'],
  team_read: ['查看协作进展', 'Check team progress'], team_wait: ['等待成员进展', 'Wait for progress'],
  team_ack: ['确认已处理回报', 'Acknowledge reports'], team_review: ['记录回报判断', 'Review report'],
  team_dismiss: ['结束成员协作', 'Dismiss teammate'],
};
export function isTeamTool(name: string) { return Object.hasOwn(titles, name); }
export function TeamToolMessage({ toolCall, interrupted, actions, timestamp }: {
  toolCall: NonNullable<ChatMessage['toolCall']>; interrupted?: boolean; actions?: React.ReactNode; timestamp?: string;
}) {
  const { locale } = useLocale();
  const english = locale === 'en-US';
  const running = toolCall.status === 'pending' || toolCall.status === 'running';
  const status = interrupted ? (english ? 'Stopped · no receipt' : '已停止 · 未收到回执')
    : toolCall.status === 'error' ? (english ? 'Operation failed' : '操作失败')
    : running ? (english ? 'In progress' : '正在处理') : (english ? 'Receipt received' : '已收到操作回执');
  const params = toolCall.params || {};
  const subject = [params.name, params.task, params.reason].find(value => typeof value === 'string' && value.trim());
  return <div className="chat__message chat__message--assistant chat__message--tool">
    <article className="team-tool-card">
      <header><strong>{titles[toolCall.toolName][english ? 1 : 0]}</strong><small>{status}</small></header>
      {typeof subject === 'string' && <p className="team-tool-subject">{subject}</p>}
      {toolCall.status === 'error' && <p role="alert">{toolCall.result}</p>}
      <details><summary>{english ? 'Operation details' : '操作详情'} · {toolCall.toolName}</summary>
        <pre>{JSON.stringify(params, null, 2)}</pre><pre>{toolCall.result}</pre>
      </details>
      {actions}{timestamp && <small>{formatTimestamp(timestamp)}</small>}
    </article>
  </div>;
}
