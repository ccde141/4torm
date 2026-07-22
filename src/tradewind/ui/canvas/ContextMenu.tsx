/**
 * 画布右键菜单 — 节点操作（删除/克隆/编辑）+ 画布空白操作（添加节点）
 */

import { useEffect, useRef } from 'react';
import { CANVAS_NODE_ITEMS, contextMenuKind } from './context-menu-model';

export interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  nodeId: string | null;
  edgeId: string | null;
  flowPosition: { x: number; y: number } | null;
}

interface ContextMenuProps {
  menu: ContextMenuState;
  onClose: () => void;
  onDelete: (nodeId: string) => void;
  onDeleteEdge: (edgeId: string) => void;
  onClone: (nodeId: string) => void;
  onEdit: (nodeId: string) => void;
  onAddNode: (type: string, position: { x: number; y: number }) => void;
}

export function ContextMenu({ menu, onClose, onDelete, onDeleteEdge, onClone, onEdit, onAddNode }: ContextMenuProps) {
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
  const kind = contextMenuKind(menu);

  return (
    <div
      ref={ref}
      className="tw-ctxmenu"
      style={{ left: menu.x, top: menu.y }}
    >
      {kind === 'node' ? (
        <NodeMenu
          nodeId={menu.nodeId!}
          onDelete={onDelete}
          onClone={onClone}
          onEdit={onEdit}
          onClose={onClose}
        />
      ) : kind === 'edge' ? (
        <EdgeMenu edgeId={menu.edgeId!} onDelete={onDeleteEdge} onClose={onClose} />
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

function EdgeMenu({ edgeId, onDelete, onClose }: {
  edgeId: string;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <button
      className="tw-ctxmenu__item tw-ctxmenu__item--danger"
      onClick={() => { onDelete(edgeId); onClose(); }}
    >
      <span className="tw-ctxmenu__icon">✕</span> 删除连线
    </button>
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
      {CANVAS_NODE_ITEMS.map((item) => (
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
