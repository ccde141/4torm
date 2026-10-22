import { useCallback, useLayoutEffect, useRef } from 'react';
import { useOnViewportChange, useReactFlow, useStore, type Viewport } from '@xyflow/react';

export type WorkflowViewportMemory = Map<string, { x: number; y: number; zoom: number }>;

/** Hidden design tabs have no usable viewport. Fit only after the new workflow is visible and measured. */
export function WorkflowInitialViewport({ active, workflowId, memory }: {
  active: boolean; workflowId?: string; memory?: WorkflowViewportMemory;
}) {
  // Read-only controlled graphs keep measurements in the internal node map.
  const ready = useStore(state => state.nodeLookup.size > 0 && [...state.nodeLookup.values()]
    .every(node => node.hidden || Boolean(node.measured?.width && node.measured?.height)));
  const width = useStore(state => state.width);
  const height = useStore(state => state.height);
  const { fitView, setCenter, getViewport, viewportInitialized } = useReactFlow();
  const fitted = useRef(false);
  const applied = useRef(false);
  const remember = useCallback((viewport: Viewport) => {
    if (applied.current && active && width && height && workflowId && memory) memory.set(workflowId, {
      x: (width / 2 - viewport.x) / viewport.zoom,
      y: (height / 2 - viewport.y) / viewport.zoom, zoom: viewport.zoom,
    });
  }, [active, width, height, workflowId, memory]);
  useOnViewportChange({ onEnd: remember });
  useLayoutEffect(() => {
    if (!active) { fitted.current = false; applied.current = false; return; }
    const saved = workflowId && memory?.get(workflowId);
    if ((!ready && !saved) || !viewportInitialized || !width || !height || fitted.current) return;
    fitted.current = true;
    const placement = saved ? setCenter(saved.x, saved.y, { zoom: saved.zoom }) : fitView({ padding: 0.2 });
    let cancelled = false;
    void placement.then(() => {
      if (cancelled) return;
      applied.current = true; remember(getViewport());
    });
    return () => { cancelled = true; if (!applied.current) fitted.current = false; };
  }, [active, ready, viewportInitialized, width, height, fitView, setCenter, getViewport, remember, workflowId, memory]);
  return null;
}
