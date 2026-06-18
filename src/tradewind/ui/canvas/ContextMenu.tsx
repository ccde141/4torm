/**
 * 画布右键菜单 — 节点操作（删除/克隆/编辑）+ 画布空白操作（添加节点）
 */

import { useEffect, useRef } from 'react';

export interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  nodeId: string | null;
  flowPosition: { x: number; y: number } | null;
}

interface ContextMenuProps {
  menu: ContextMenuState;
  onClose: () => void;
  onDelete: (nodeId: string) => void;
  onClone: (nodeId: string) => void;
  onEdit: (nodeId: string) => void;
  onAddNode: (type: string, position: { x: number; y: number }) => void;
}

const NODE_TYPES = [
  { type: 'entry', label: '入口', icon: '▶' },
  { type: 'agent', label: 'Agent', icon: '⚡' },
  { type: 'meeting', label: '会议室', icon: '◎' },
  { type: 'note', label: 'Note', icon: '📝' },
  { type: 'output', label: '出口', icon: '◼' },
] as const;

export function ContextMenu({ menu, onClose, onDelete, onClone, onEdit, onAddNode }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu.visible) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as HTMLElement)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menu.visible, onClose]);

  if (!menu.visible) return null;

  return (
    <div
      ref={ref}
      className="tw-ctxmenu"
      style={{ left: menu.x, top: menu.y }}
    >
      {menu.nodeId ? (
        <NodeMenu
          nodeId={menu.nodeId}
          onDelete={onDelete}
          onClone={onClone}
          onEdit={onEdit}
          onClose={onClose}
        />
      ) : (
        <PaneMenu
          position={menu.flowPosition!}
          onAddNode={onAddNode}
          onClose={onClose}
        />
      )}
    </div>
  );
}

// ── 节点右键菜单 ──────────────────────────────────────────────────

function NodeMenu({ nodeId, onDelete, onClone, onEdit, onClose }: {
  nodeId: string;
  onDelete: (id: string) => void;
  onClone: (id: string) => void;
  onEdit: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <>
      <button className="tw-ctxmenu__item" onClick={() => { onEdit(nodeId); onClose(); }}>
        <span className="tw-ctxmenu__icon">⚙</span> 编辑配置
      </button>
      <button className="tw-ctxmenu__item" onClick={() => { onClone(nodeId); onClose(); }}>
        <span className="tw-ctxmenu__icon">⧉</span> 克隆节点
      </button>
      <div className="tw-ctxmenu__divider" />
      <button className="tw-ctxmenu__item tw-ctxmenu__item--danger" onClick={() => { onDelete(nodeId); onClose(); }}>
        <span className="tw-ctxmenu__icon">✕</span> 删除节点
      </button>
    </>
  );
}

// ── 画布空白右键菜单 ──────────────────────────────────────────────

function PaneMenu({ position, onAddNode, onClose }: {
  position: { x: number; y: number };
  onAddNode: (type: string, pos: { x: number; y: number }) => void;
  onClose: () => void;
}) {
  return (
    <>
      <div className="tw-ctxmenu__title">添加节点</div>
      {NODE_TYPES.map((item) => (
        <button
          key={item.type}
          className="tw-ctxmenu__item"
          onClick={() => { onAddNode(item.type, position); onClose(); }}
        >
          <span className="tw-ctxmenu__icon">{item.icon}</span> {item.label}
        </button>
      ))}
    </>
  );
}
