import { useState } from 'react';
import type { ChatMessage } from '../../../types';

type Step = {
  type: 'tool' | 'thought';
  tool?: string;
  args?: Record<string, string>;
  result?: string;
  ok?: boolean;
  text?: string;
};

/**
 * DelegateCard — SubAgent 委托任务卡片
 *
 * 对齐季风：无 avatar，缩进 + 左边色条 + 圆形状态图标。
 * 折叠时显示任务摘要、步骤计数；展开后显示步骤列表与结果。
 */
export default function DelegateCard({ toolCall, content }: {
  toolCall: NonNullable<ChatMessage['toolCall']> & { steps?: Step[] };
  content?: string;
}) {
  const [expanded, setExpanded] = useState(false);

  const task = toolCall.params?.task || '子任务';
  const status = toolCall.status || 'pending';
  const summary = toolCall.result || '';
  const steps: Step[] = (toolCall as any).steps || [];
  const durationMs = toolCall.durationMs || 0;

  const isPending = status === 'pending';
  const isError = status === 'error';
  const color = isPending ? '#eab308' : isError ? 'var(--color-error)' : 'var(--color-success)';
  const icon = isPending ? '◌' : isError ? '✗' : '✓';

  const taskBrief = task.length > 60 ? task.slice(0, 60) + '...' : task;
  const toolSteps = steps.filter(s => s.type === 'tool');
  const durationStr = durationMs > 0 ? `${(durationMs / 1000).toFixed(1)}s` : '';

  const subtitle = isPending
    ? (toolSteps.length > 0 ? `${toolSteps.length} 步执行中...` : '思考中...')
    : (durationStr ? `${toolSteps.length} 步 · ${durationStr}` : `${toolSteps.length} 步`);

  return (
    <div className="tw-chat-row tw-chat-row--assistant" style={{ paddingLeft: '38px' }}>
      <div className="tw-chat-bubble" style={{ borderLeft: `3px solid ${color}`, padding: 0, overflow: 'hidden', minWidth: '280px' }}>
        {/* 头部 */}
        <button
          className="tw-tool-card__header"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
        >
          <span className="tw-tool-card__status-dot" style={{ color }}>{icon}</span>
          <span className="tw-tool-card__name tw-tool-card__name--ellipsis">{taskBrief}</span>
          {isPending && <span className="tw-tool-card__spinner" />}
          <span className="tw-tool-card__status">{subtitle}</span>
          <span className={`tw-tool-card__arrow${expanded ? ' tw-tool-card__arrow--open' : ''}`}>▶</span>
        </button>

        {/* 折叠态：最后一步 或 结果预览 */}
        {!expanded && isPending && toolSteps.length > 0 && (
          <div className="tw-tool-card__preview tw-tool-card__preview--mono">
            {toolSteps[toolSteps.length - 1].tool}{toolSteps[toolSteps.length - 1].result ? ' ✓' : ' ...'}
          </div>
        )}
        {!expanded && !isPending && summary && (
          <div className="tw-tool-card__preview">
            {summary.slice(0, 120)}{summary.length > 120 ? '...' : ''}
          </div>
        )}

        {/* 展开后 */}
        {expanded && (
          <div className="tw-tool-card__body">
            {/* 任务描述 */}
            <div>
              <div className="tw-tool-card__section-label">任务</div>
              <div className="tw-tool-card__text">{task}</div>
            </div>

            {/* 步骤列表 */}
            {toolSteps.length > 0 && (
              <div>
                <div className="tw-tool-card__section-label">执行步骤</div>
                <div className="tw-tool-card__steps tw-tool-card__steps--inline">
                  {toolSteps.map((s, i) => {
                    const stepDone = s.result != null;
                    const stepOk = s.ok !== false;
                    const stepColor = stepDone ? (stepOk ? 'var(--color-success)' : 'var(--color-error)') : '#eab308';
                    const stepIcon = stepDone ? (stepOk ? '✓' : '✗') : '◌';
                    return (
                      <div key={i} className="tw-tool-card__step">
                        <span style={{ color: stepColor, flexShrink: 0 }}>{stepIcon}</span>
                        <span className="tw-tool-card__step-name">{s.tool}</span>
                        {s.result && (
                          <span className="tw-tool-card__step-detail">
                            {s.result.slice(0, 60)}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 思考过程 */}
            {content && (
              <div>
                <div className="tw-tool-card__section-label">思考过程</div>
                <pre className="tw-tool-card__pre" style={{ maxHeight: '200px' }}>
                  {content}
                </pre>
              </div>
            )}

            {/* 最终结果 */}
            {summary && (
              <div>
                <div className="tw-tool-card__section-label">结果 {icon}</div>
                <pre className="tw-tool-card__pre" style={{ maxHeight: '300px' }}>
                  {summary}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
