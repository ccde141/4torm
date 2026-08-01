import ExecutionSurfaceViewport from './ExecutionSurfaceViewport';
import { getExecutionSurfaceCapability } from './execution-surface-capability';
import {
  selectOpenExecutionSurfaceItems,
  canTerminateExecution,
  type ExecutionSurfaceItem,
} from './execution-surface';

type Scope = 'conversation' | 'cyclone';

export default function ExecutionSurfaceOverlay({
  scope,
  ownerId,
  items,
  openIds,
  activeId,
  reservedRight,
  onSelect,
  onCloseTab,
  closingId,
  onTerminate,
  onClose,
}: {
  scope: Scope;
  ownerId: string;
  items: ExecutionSurfaceItem[];
  openIds: readonly string[];
  activeId: string | null;
  reservedRight: number;
  onSelect: (id: string) => void;
  onCloseTab: (id: string) => void;
  closingId?: string | null;
  onTerminate: (id: string) => void;
  onClose: () => void;
}) {
  const tabs = selectOpenExecutionSurfaceItems(items, openIds);
  const selected = tabs.find(item => item.id === activeId);
  if (!selected) return null;

  return (
    <div className="execution-surface-backdrop" style={{ ...backdropStyle, right: reservedRight }}>
      <section className="execution-surface-panel" role="dialog" aria-modal="true" aria-label="运行窗口" style={panelStyle}>
        <header style={headerStyle}>
          <div className="execution-surface-tabs" style={tabListStyle} aria-label="已打开的运行内容">
            {tabs.map(item => <div className="execution-surface-tab" key={item.id} style={tabItemStyle}>
              <button className="execution-surface-tab__select" type="button" onClick={() => onSelect(item.id)} title={item.command} style={{ ...tabStyle, ...(item.id === selected.id ? activeTabStyle : {}) }}>
                <span style={{ ...dotStyle, ...(item.status === 'failed' ? failedDotStyle : {}) }} />
                <span style={tabLabelStyle}>{tabLabel(item)}</span>
              </button>
              <button className="execution-surface-tab__close" type="button" onClick={() => onCloseTab(item.id)} title="关闭标签" aria-label={`关闭标签：${tabLabel(item)}`} style={tabCloseStyle}>×</button>
            </div>)}
          </div>
          {canTerminateExecution(selected) && (
            <button className="execution-surface-action execution-surface-action--danger" type="button" onClick={() => onTerminate(selected.id)} disabled={closingId === selected.id || selected.status === 'cancelling'} style={terminateStyle}>
              {terminationLabel(selected, closingId === selected.id || selected.status === 'cancelling')}
            </button>
          )}
          <button className="execution-surface-action execution-surface-action--icon" type="button" onClick={onClose} title="收起运行窗口" aria-label="收起运行窗口" style={closeStyle}>×</button>
        </header>
        <div style={contentStyle}>
          <ExecutionSurfaceViewport scope={scope} ownerId={ownerId} item={selected} onBack={onClose} />
        </div>
      </section>
    </div>
  );
}

function tabLabel(item: ExecutionSurfaceItem): string {
  const capability = getExecutionSurfaceCapability(item.viewer);
  return item.command.replace(capability.commandPrefix ?? /$^/, '') || capability.fallbackLabel;
}

function terminationLabel(item: ExecutionSurfaceItem, pending: boolean): string {
  const lifecycle = getExecutionSurfaceCapability(item.viewer).lifecycle;
  return pending ? lifecycle.pendingLabel : lifecycle.actionLabel;
}

const backdropStyle: React.CSSProperties = {
  position: 'fixed',
  left: 0,
  top: 0,
  bottom: 0,
  zIndex: 40,
  display: 'grid',
  placeItems: 'center',
  padding: '12px',
  background: 'rgba(4, 12, 18, 0.36)',
  backdropFilter: 'blur(5px)',
  WebkitBackdropFilter: 'blur(5px)',
};
const panelStyle: React.CSSProperties = {
  width: 'min(70vw, 1180px)',
  maxWidth: 'calc(100vw - 48px)',
  height: 'min(78vh, 840px)',
  maxHeight: 'calc(100vh - 24px)',
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column',
  border: '1px solid var(--glass-border)',
  borderRadius: 'var(--radius-md)',
  background: 'var(--glass-bg-strong)',
  boxShadow: '0 20px 64px -24px rgba(0, 0, 0, 0.72)',
};
const headerStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', minWidth: 0, gap: 'var(--space-2)', padding: 'var(--space-2) var(--space-3)', borderBottom: '1px solid var(--glass-border)' };
const tabListStyle: React.CSSProperties = { minWidth: 0, flex: 1, display: 'flex', gap: 'var(--space-1)', overflowX: 'auto' };
const tabItemStyle: React.CSSProperties = { flex: '0 1 190px', minWidth: 108, display: 'flex', alignItems: 'center', overflow: 'hidden' };
const tabStyle: React.CSSProperties = { minWidth: 0, flex: 1, display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden', padding: '5px 8px', appearance: 'none', border: '1px solid transparent', borderRadius: 'var(--radius-sm)', background: 'transparent', color: 'var(--color-text-tertiary)', cursor: 'pointer', fontSize: 'var(--text-xs)', textAlign: 'left' };
const tabCloseStyle: React.CSSProperties = { width: 24, height: 24, flexShrink: 0, appearance: 'none', border: 'none', borderRadius: 'var(--radius-sm)', background: 'transparent', color: 'var(--color-text-tertiary)', cursor: 'pointer', fontSize: '15px', lineHeight: 1 };
const terminateStyle: React.CSSProperties = { height: 26, flexShrink: 0, padding: '0 var(--space-2)', appearance: 'none', border: '1px solid rgba(248, 113, 113, 0.5)', borderRadius: 'var(--radius-sm)', background: 'rgba(220, 38, 38, 0.16)', color: '#fecaca', cursor: 'pointer', fontSize: 'var(--text-xs)' };
const activeTabStyle: React.CSSProperties = { borderColor: 'var(--glass-border)', background: 'var(--glass-bg)', color: 'var(--color-text-primary)' };
const dotStyle: React.CSSProperties = { width: 6, height: 6, flexShrink: 0, borderRadius: '50%', background: 'var(--color-accent)', boxShadow: '0 0 7px var(--color-accent-glow)' };
const failedDotStyle: React.CSSProperties = { background: 'var(--color-error)', boxShadow: 'none' };
const tabLabelStyle: React.CSSProperties = { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
const closeStyle: React.CSSProperties = { width: 24, height: 24, flexShrink: 0, appearance: 'none', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', background: 'transparent', color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: '14px' };
const contentStyle: React.CSSProperties = { minHeight: 0, flex: 1 };
