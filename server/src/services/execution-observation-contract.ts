/**
 * Stable vocabulary shared by execution producers and the observation read model.
 * Keep capability-specific concepts (browser targets, driver sessions, terminal PTYs)
 * out of this contract so adding a new surface does not couple observers to its driver.
 */
export type ObservationScope = 'conversation' | 'cyclone';
export type ObservationStatus = 'running' | 'waiting' | 'cancelling' | 'completed' | 'failed' | 'cancelled' | 'crashed';
export type ObservationTerminalStatus = Exclude<ObservationStatus, 'running' | 'waiting' | 'cancelling'>;
export type ObservationStream = 'stdout' | 'stderr';
export type ObservationKind = 'terminal' | 'browser' | 'computer';
export type ObservationViewer = 'terminal' | 'browser' | 'computer';
export type ObservationPresentation = 'embedded-visible' | 'external-visible' | 'hidden';

export interface VisualObservationState {
  control: 'agent' | 'human';
  revision: number;
  presentation?: ObservationPresentation;
  summary?: string;
  frameUpdatedAt?: number;
}
