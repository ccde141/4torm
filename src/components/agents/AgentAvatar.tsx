import { useEffect, useState } from 'react';
import type { Agent } from '../../types';
import { avatarUrl } from './agent-avatar-client';
import '../../styles/components/agent-avatar.css';

export default function AgentAvatar({ agent, className, fallback }: {
  agent?: Agent | null;
  className: string;
  fallback?: string;
}) {
  const [failed, setFailed] = useState(false);
  const version = agent?.avatar?.version;
  useEffect(() => setFailed(false), [agent?.id, version]);
  const label = fallback || agent?.name?.slice(0, 2) || 'AI';

  return (
    <div className={className} aria-label={agent ? `${agent.name}的头像` : undefined}>
      {agent && version && !failed ? (
        <img className="agent-avatar__image" src={avatarUrl(agent.id, version)} alt=""
          onError={() => setFailed(true)} />
      ) : label}
    </div>
  );
}
