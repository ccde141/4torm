import NativeObservationView from './NativeObservationView';
import TerminalObservationView from './TerminalObservationView';
import VisualObservationView from './VisualObservationView';
import { getExecutionSurfaceCapability } from './execution-surface-capability';
import { shouldUseNativeExecutionSurface, type ExecutionSurfaceItem } from './execution-surface';

type Scope = 'conversation' | 'cyclone';
type Props = { scope: Scope; ownerId: string; item: ExecutionSurfaceItem; onBack: () => void; suspendNativeSurface?: boolean };

/** Rendering is selected from capability metadata; the overlay owns no viewer-specific branch. */
export default function ExecutionSurfaceViewport({ scope, ownerId, item, onBack, suspendNativeSurface }: Props) {
  const capability = getExecutionSurfaceCapability(item.viewer);
  const props = { scope, ownerId, observationId: item.id, onBack };
  if (capability.renderMode === 'terminal') return <TerminalObservationView {...props} />;
  if (shouldUseNativeExecutionSurface(item, Boolean(window.desktop))) return <NativeObservationView {...props} suspended={suspendNativeSurface} />;
  return <VisualObservationView {...props} />;
}
