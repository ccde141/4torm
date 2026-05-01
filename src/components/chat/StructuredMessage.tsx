import { useState, type ReactNode } from 'react';

interface ToolStep {
  tool: string;
  args: Record<string, string>;
  result?: string;
  status: 'pending' | 'running' | 'done' | 'error';
}

interface Props {
  think: string;
  plan: string;
  planItems: Array<{ done: boolean; text: string }>;
  tools: ToolStep[];
  answer: string;
  note: string;
  msgId: string;
  onDelete?: () => void;
  actions?: ReactNode;
}

export default function StructuredMessage({ think, plan, planItems, tools, answer, note, msgId, onDelete, actions }: Props) {
  const [showThink, setShowThink] = useState(false);
  const [showTool, setShowTool] = useState<Record<number, boolean>>({});
  const [showNote, setShowNote] = useState(false);

  const toggleTool = (idx: number) => {
    setShowTool(prev => ({ ...prev, [idx]: !prev[idx] }));
  };

  return (
    <div className="chat__message chat__message--assistant">
      <div className="chat__avatar">AI</div>
      <div className="chat__bubble stmsg-bubble">
        {(think || plan) && (
          <div className="stmsg-section stmsg-section--collapsible">
            <button className="stmsg-collapse-trigger" onClick={() => setShowThink(!showThink)} aria-expanded={showThink}>
              <span className="stmsg-collapse-arrow">{showThink ? '▼' : '▶'}</span>
              <span className="stmsg-collapse-label">思考过程</span>
            </button>
            {showThink && (
              <div className="stmsg-collapse-body">
                {think && <div className="stmsg-think">{think}</div>}
                {planItems.length > 0 && (
                  <div className="stmsg-plan">
                    {planItems.map((p, i) => (
                      <div key={i} className={`stmsg-plan-item stmsg-plan-item--${p.done ? 'done' : 'pending'}`}>
                        <span className="stmsg-plan-mark">{p.done ? '✓' : '○'}</span>
                        <span>{p.text}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {tools.map((t, i) => (
          <div key={i} className={`stmsg-tool stmsg-tool--${t.status}`}>
            <button className="stmsg-tool-header" onClick={() => toggleTool(i)} aria-expanded={showTool[i] ?? false}>
              <span className="stmsg-tool-arrow">{showTool[i] ? '▼' : '▶'}</span>
              <span className={`stmsg-tool-icon stmsg-tool-icon--${t.status}`}>
                {t.status === 'running' ? '⏳' : t.status === 'done' ? '✅' : t.status === 'error' ? '❌' : '⏸'}
              </span>
              <span className="stmsg-tool-name">{t.tool}</span>
              {t.status === 'running' && <span className="thinking-card__tool-spinner" />}
            </button>
            {showTool[i] && (
              <div className="stmsg-tool-detail">
                <div className="stmsg-tool-section">
                  <span className="stmsg-tool-label">参数</span>
                  <pre>{JSON.stringify(t.args, null, 2)}</pre>
                </div>
                {t.result && (
                  <div className="stmsg-tool-section">
                    <span className="stmsg-tool-label">结果</span>
                    <pre>{t.result}</pre>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}

        {answer && (
          <div className="stmsg-answer">{answer}</div>
        )}

        {note && (
          <div className="stmsg-note-area">
            <button className="stmsg-note-trigger" onClick={() => setShowNote(!showNote)} aria-expanded={showNote}>
              ℹ {showNote ? '收起提示' : '查看提示'}
            </button>
            {showNote && <div className="stmsg-note-body">{note}</div>}
          </div>
        )}
        {actions && <div className="chat__bubble-actions">{actions}</div>}
      </div>
    </div>
  );
}
