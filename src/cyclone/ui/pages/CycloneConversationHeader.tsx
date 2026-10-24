import type { ReactNode } from 'react';
import './cyclone-conversation-header.css';

export function CycloneTokenBadge({ token }: { token: { label: string; title: string } }) {
  return <span className="cyclone-conversation-header__tokens" title={token.title}>{token.label}</span>;
}

export default function CycloneConversationHeader({ title, topic, token, children, endInset = 0 }: {
  title: string;
  topic?: string;
  token: { label: string; title: string };
  children?: ReactNode;
  endInset?: number;
}) {
  return <div className="cyclone-conversation-header"
    style={endInset ? { paddingRight: `calc(var(--space-5) + ${endInset}px)` } : undefined}>
    {(title || topic) && <div className="cyclone-conversation-header__identity"
      style={topic ? undefined : { flexBasis: 0 }}>
      {title && <span className="cyclone-conversation-header__title" title={title}>{title}</span>}
      {topic && <span className="cyclone-conversation-header__topic" title={topic}>{topic}</span>}
    </div>}
    <div className="cyclone-conversation-header__utilities">
      <CycloneTokenBadge token={token} />
      {children}
    </div>
  </div>;
}
