/**
 * 信风画布主组件 — @xyflow/react 封装
 *
 * 职责：
 * - 渲染 ReactFlow 画布
 * - 注册自定义节点类型（5 种）+ 自定义边
 * - 处理节点选中、拖放、右键菜单
 */

import { useCallback, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  MiniMap,
  Controls,
  type ReactFlowInstance,
  type NodeTypes,
  type EdgeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { EntryNode } from './nodes/EntryNode';
import { OutputNode } from './nodes/OutputNode';
import { AgentNode } from './nodes/AgentNode';
import { MeetingNode } from './nodes/MeetingNode';
import { NoteNode } from './nodes/NoteNode';
import { HumanGateNode } from './nodes/HumanGateNode';
import { TradeWindEdge } from './edges/TradeWindEdge';
import { ContextMenu, type ContextMenuState } from './ContextMenu';
import { useConfirm } from '../../../components/common/ConfirmDialog';
import type { WorkflowStoreState, WorkflowStoreActions } from '../hooks/useWorkflowStore';

interface TradeWindCanvasProps {
  store: WorkflowStoreState & WorkflowStoreActions;
}

const nodeTypes: NodeTypes = {
  entry: EntryNode,
  output: OutputNode,
  agent: AgentNode,
  meeting: MeetingNode,
  note: NoteNode,
  'human-gate': HumanGateNode,
};

const edgeTypes: EdgeTypes = {
  tradewind: TradeWindEdge,
};

const MENU_INIT: ContextMenuState = { visible: false, x: 0, y: 0, nodeId: null, flowPosition: null };

export function TradeWindCanvas({ store }: TradeWindCanvasProps) {
  const confirm = useConfirm();
  const rfInstance = useRef<ReactFlowInstance | null>(null);
  const [menu, setMenu] = useState<ContextMenuState>(MENU_INIT);

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: { id: string }) => {
      store.selectNode(node.id);
    },
    [store],
  );

  const onPaneClick = useCallback(() => {
    store.selectNode(null);
    setMenu(MENU_INIT);
  }, [store]);

  const canvasRef = useRef<HTMLDivElement>(null);

  /** 计算相对于 canvas 容器的菜单坐标（修正 fixed 定位被 backdrop-filter 破坏的问题） */
  const getMenuPos = useCallback((clientX: number, clientY: number) => {
    if (!canvasRef.current) return { x: clientX, y: clientY };
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }, []);

  /** 节点右键 */
  const onNodeContextMenu = useCallback(
    (event: React.MouseEvent, node: { id: string }) => {
      event.preventDefault();
      const pos = getMenuPos(event.clientX, event.clientY);
      setMenu({ visible: true, x: pos.x, y: pos.y, nodeId: node.id, flowPosition: null });
    },
    [getMenuPos],
  );

  /** 画布空白右键 */
  const onPaneContextMenu = useCallback(
    (event: React.MouseEvent | MouseEvent) => {
      event.preventDefault();
      if (!rfInstance.current) return;
      const clientX = (event as MouseEvent).clientX;
      const clientY = (event as MouseEvent).clientY;
      const flowPos = rfInstance.current.screenToFlowPosition({ x: clientX, y: clientY });
      const pos = getMenuPos(clientX, clientY);
      setMenu({ visible: true, x: pos.x, y: pos.y, nodeId: null, flowPosition: flowPos });
    },
    [getMenuPos],
  );

  /** 拖放：从 NodePalette 拖入新节点 */
  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const type = event.dataTransfer.getData('application/tradewind-node');
      if (!type || !rfInstance.current) return;
      const position = rfInstance.current.screenToFlowPosition({ x: event.clientX, y: event.clientY });
      store.addNode(type, position);
    },
    [store],
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  /** 右键边：直接删除（带确认对话框） */
  const onEdgeContextMenu = useCallback(
    async (event: React.MouseEvent, edge: { id: string }) => {
      event.preventDefault();
      if (await confirm({ title: '删除这条连线？', confirmText: '删除', danger: true })) {
        store.deleteEdge(edge.id);
      }
    },
    [store, confirm],
  );

  return (
    <div className="tw-canvas" ref={canvasRef}>
      <ReactFlow
        nodes={store.nodes}
        edges={store.edges}
        onNodesChange={store.onNodesChange}
        onEdgesChange={store.onEdgesChange}
        onConnect={store.onConnect}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        onNodeContextMenu={onNodeContextMenu}
        onPaneContextMenu={onPaneContextMenu}
        onEdgeContextMenu={onEdgeContextMenu}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onInit={(instance) => { rfInstance.current = instance; }}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultEdgeOptions={{ type: 'tradewind' }}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="rgba(255,255,255,0.04)" />
        <Controls showInteractive={false} className="tw-controls" />
        <MiniMap
          className="tw-minimap"
          nodeColor={(node) => {
            const colors: Record<string, string> = { entry: '#3b82f6', output: '#22c55e', agent: '#f59e0b', meeting: '#a855f7', note: '#fbbf24', 'human-gate': '#eab308' };
            return colors[node.type ?? ''] ?? '#71717a';
          }}
          maskColor="rgba(15, 23, 42, 0.8)"
        />
      </ReactFlow>
      <ContextMenu
        menu={menu}
        onClose={() => setMenu(MENU_INIT)}
        onDelete={(id) => store.deleteNode(id)}
        onClone={(id) => store.cloneNode(id)}
        onEdit={(id) => store.selectNode(id)}
        onAddNode={(type, pos) => store.addNode(type, pos)}
      />
    </div>
  );
}
