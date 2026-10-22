import { ReactFlowProvider } from '@xyflow/react';
import { TradeWindCanvas } from '../canvas/TradeWindCanvas';
import { NodePalette } from '../panels/NodePalette';
import { ConfigPanel } from '../panels/ConfigPanel';
import type { TradeWindWorkspace } from './useTradeWindWorkspace';

export function WorkflowEditor({ model }: { model: TradeWindWorkspace }) {
  const { store, execution } = model;
  const selected = store.nodes.find(node => node.id === store.selectedNodeId) ?? null;
  return <div className="tw-workspace-editor">
    <NodePalette orchestration={store.orchestration} />
    <ReactFlowProvider><TradeWindCanvas store={store} executionPhase={execution.phase}
      executionId={execution.executionId} active={model.nav.tab === 'design'} viewports={model.viewports.current} /></ReactFlowProvider>
    <ConfigPanel node={selected} nodes={store.nodes} edges={store.edges}
      onClose={() => store.selectNode(null)} onUpdate={store.updateNodeData} onSyncReworkEdge={store.syncReworkEdge} />
  </div>;
}
