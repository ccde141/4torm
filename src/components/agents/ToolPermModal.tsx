import { useState, useEffect } from 'react';
import { getTools } from '../../store/tools';
import { getPermissions, savePermissions } from '../../api/tools-permissions';
import type { ToolDef } from '../../store/tools';

interface Props {
  agentId: string;
  agentName: string;
  onClose: () => void;
}

export default function ToolPermModal({ agentId, agentName, onClose }: Props) {
  const [allTools, setAllTools] = useState<ToolDef[]>([]);
  const [perms, setPerms] = useState<Record<string, string>>({});

  useEffect(() => {
    getTools().then(tools => setAllTools(tools.filter(t => t.dangerous)));
    getPermissions(agentId).then(setPerms);
  }, [agentId]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleToggle = async (toolName: string, level: 'always' | 'ask') => {
    const updated = { ...perms, [toolName]: level };
    setPerms(updated);
    await savePermissions(agentId, updated);
  };

  return (
    <div role="dialog" aria-modal="true" aria-label={`${agentName} 工具权限`} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }} onClick={onClose}>
      <div style={{ background: 'var(--color-surface)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: 'var(--space-6)', maxWidth: '400px', width: '90%' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
          <div>
            <div style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--font-bold)' }}>{agentName} — 工具权限</div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', marginTop: '2px' }}>开启 = 直接执行，关闭 = 每次询问</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--color-text-tertiary)', fontSize: 'var(--text-lg)', cursor: 'pointer' }}>✕</button>
        </div>

        {allTools.length === 0 && (
          <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)', padding: 'var(--space-4)', textAlign: 'center' }}>
            暂无危险工具
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {allTools.map(t => {
            const isAlways = perms[t.name] === 'always';
            return (
              <div key={t.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--space-2) var(--space-3)', background: 'var(--color-bg)', borderRadius: 'var(--radius-sm)' }}>
                <div>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)', fontWeight: 'var(--font-medium)' }}>{t.name}</span>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)' }}>{t.description}</div>
                </div>
                <button
                  onClick={() => handleToggle(t.name, isAlways ? 'ask' : 'always')}
                  style={{
                    width: 36, height: 20, borderRadius: '10px',
                    border: 'none', padding: 0, cursor: 'pointer',
                    background: isAlways ? '#4ade80' : 'var(--color-bg-hover)',
                    position: 'relative', transition: 'background 0.2s',
                  }}
                >
                  <span style={{
                    display: 'block', width: 16, height: 16, borderRadius: '50%',
                    background: 'var(--color-text-primary)', position: 'absolute', top: 2,
                    left: isAlways ? 18 : 2, transition: 'left 0.2s',
                  }} />
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
