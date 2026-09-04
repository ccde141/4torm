import { useEffect, useId, useRef, useState } from 'react';
import { BaseEdge, getSmoothStepPath, type Edge, type EdgeProps } from '@xyflow/react';

export interface CollaborationEdgeData extends Record<string, unknown> {
  direction: 'both' | 'forward';
  dispatchActive: boolean;
  contactActive: boolean;
  returnSignal: number;
}

type ActivityMode = 'contact' | 'dispatch' | 'return';

export function CollaborationEdge(props: EdgeProps<Edge<CollaborationEdgeData>>) {
  const pathId = `cyclone-edge-${useId().replace(/:/g, '')}`;
  const returning = useReturnSignal(props.data?.returnSignal ?? 0);
  const [path] = getSmoothStepPath({
    sourceX: props.sourceX, sourceY: props.sourceY,
    targetX: props.targetX, targetY: props.targetY,
    sourcePosition: props.sourcePosition, targetPosition: props.targetPosition,
    borderRadius: 12,
  });
  const mode = getActivityMode(props.data, returning);
  const active = mode === 'dispatch' ? ' cyclone-org-edge--active'
    : mode === 'contact' ? ' cyclone-org-edge--contact-active'
      : mode === 'return' ? ' cyclone-org-edge--return' : '';

  return <>
    <BaseEdge path={path} className={`cyclone-org-edge${active}`} markerEnd={props.markerEnd} />
    <path id={pathId} d={path} className="cyclone-org-edge__motion-path" />
    {mode && <EdgeActivity path={path} pathId={pathId} mode={mode} reverse={mode === 'return'} />}
  </>;
}

function useReturnSignal(signal: number): boolean {
  const [returning, setReturning] = useState(false);
  const previousSignal = useRef(signal);
  useEffect(() => {
    if (signal <= previousSignal.current) {
      previousSignal.current = signal;
      return;
    }
    previousSignal.current = signal;
    setReturning(true);
    const timer = window.setTimeout(() => setReturning(false), 1_100);
    return () => window.clearTimeout(timer);
  }, [signal]);
  return returning;
}

function getActivityMode(data: CollaborationEdgeData | undefined, returning: boolean): ActivityMode | null {
  if (data?.dispatchActive) return 'dispatch';
  if (data?.contactActive) return 'contact';
  return returning ? 'return' : null;
}

function EdgeActivity({ path, pathId, mode, reverse }: { path: string; pathId: string; mode: ActivityMode; reverse: boolean }) {
  const particles = mode === 'dispatch' ? ['0s'] : mode === 'contact' ? ['0s', '-0.9s'] : ['0s'];
  return <g className={`cyclone-org-edge__activity cyclone-org-edge__activity--${mode}`}>
    <path d={path} className="cyclone-org-edge__glow" />
    {particles.map(begin => <FlowParticle key={begin} pathId={pathId} mode={mode} reverse={reverse} begin={begin} />)}
  </g>;
}

function FlowParticle({ pathId, mode, reverse, begin }: { pathId: string; mode: ActivityMode; reverse: boolean; begin: string }) {
  const duration = mode === 'dispatch' ? '2.8s' : mode === 'contact' ? '1.8s' : '1s';
  return <circle r={mode === 'dispatch' ? 2.6 : 3} className={`cyclone-org-edge__particle cyclone-org-edge__particle--${mode}`}>
    <animateMotion begin={begin} calcMode="linear" dur={duration}
      keyPoints={reverse ? '1;0' : '0;1'} keyTimes="0;1"
      repeatCount={mode === 'return' ? '1' : 'indefinite'}>
      <mpath href={`#${pathId}`} />
    </animateMotion>
  </circle>;
}
