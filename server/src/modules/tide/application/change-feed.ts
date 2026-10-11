/** Invalidation only; repositories and operation facts remain the source of truth. */
export type TideChangeTarget =
  | { scope: 'task'; agentId: string; taskId: string }
  | { scope: 'run'; agentId?: string; taskId: string; runId: string }
  | { scope: 'record'; taskId: string; runId?: string }
  | { scope: 'session'; agentId: string; sessionId: string; taskId?: string };

export type TideChangeSignal = TideChangeTarget & { type: 'change'; revision: number };
type Listener = (signal: TideChangeSignal) => void;

export class TideChangeFeed {
  private revision = 0;
  private readonly listeners = new Set<Listener>();

  get listenerCount(): number { return this.listeners.size; }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  publish(target: TideChangeTarget): void {
    const signal: TideChangeSignal = { ...target, type: 'change', revision: ++this.revision };
    for (const listener of this.listeners) {
      try { listener(signal); }
      catch { this.listeners.delete(listener); }
    }
  }
}
