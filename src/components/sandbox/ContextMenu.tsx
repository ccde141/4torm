import { useEffect, useRef, useState } from 'react';

export interface ContextMenuItem {
  label: string;
  action?: () => void;
  shortcut?: string;
  danger?: boolean;
  divider?: boolean;
  children?: ContextMenuItem[];
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export default function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const [openSubmenu, setOpenSubmenu] = useState<number | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, [onClose]);

  const scheduleClose = () => {
    closeTimer.current = setTimeout(() => setOpenSubmenu(null), 200);
  };

  const cancelClose = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = undefined;
    }
  };

  const handleItemEnter = (i: number) => {
    cancelClose();
    setOpenSubmenu(i);
  };

  const handleItemLeave = () => {
    scheduleClose();
  };

  const handleItemClick = (item: ContextMenuItem) => {
    if (item.children) return;
    item.action?.();
    onClose();
  };

  return (
    <>
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 999 }}
        onClick={onClose}
        onContextMenu={(e) => { e.preventDefault(); onClose(); }}
      />
      <div className="context-menu" style={{ left: x, top: y }}>
        {items.map((item, i) => {
          if (item.divider) return <div key={i} className="context-divider" />;

          if (item.children) {
            return (
              <div
                key={i}
                style={{ position: 'relative' }}
                onMouseEnter={() => handleItemEnter(i)}
                onMouseLeave={handleItemLeave}
              >
                <button
                  className="context-item"
                  onClick={(e) => e.preventDefault()}
                  style={{ cursor: 'default' }}
                >
                  <span>{item.label}</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    {item.shortcut && (
                      <span className="context-shortcut" style={{ marginLeft: 0 }}>{item.shortcut}</span>
                    )}
                    <span style={{ fontSize: '9px', color: 'var(--color-text-tertiary)' }}>&#9654;</span>
                  </span>
                </button>
                {openSubmenu === i && (
                  <div
                    className="context-submenu"
                    onMouseEnter={() => handleItemEnter(i)}
                    onMouseLeave={handleItemLeave}
                  >
                    {item.children.map((child, j) => {
                      if (child.divider) return <div key={j} className="context-divider" />;
                      return (
                        <button
                          key={j}
                          className={`context-item${child.danger ? ' context-item--danger' : ''}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            child.action?.();
                            onClose();
                          }}
                        >
                          <span>{child.label}</span>
                          {child.shortcut && <span className="context-shortcut">{child.shortcut}</span>}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          }

          return (
            <button
              key={i}
              className={`context-item${item.danger ? ' context-item--danger' : ''}`}
              onClick={() => handleItemClick(item)}
            >
              <span>{item.label}</span>
              {item.shortcut && <span className="context-shortcut">{item.shortcut}</span>}
            </button>
          );
        })}
      </div>
    </>
  );
}
