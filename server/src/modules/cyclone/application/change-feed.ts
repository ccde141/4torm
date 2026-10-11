/** A wake-up signal. Durable workshop, room, and run records remain the source of truth. */
export type CycloneChangeScope = 'workshop' | 'room' | 'bulletin'
  | 'activity' | 'dispatch';

export interface CycloneChangeSignal {
  type: 'change';
  workshopId: string;
  scope: CycloneChangeScope;
  id: string;
  revision: number;
}

type Listener = (signal: CycloneChangeSignal) => void;

export class CycloneChangeFeed {
  private revision = 0;
  private readonly listeners = new Set<Listener>();

  get listenerCount(): number { return this.listeners.size; }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  publish(workshopId: string, scope: CycloneChangeScope, id: string): void {
    const signal: CycloneChangeSignal = {
      type: 'change', workshopId, scope, id, revision: ++this.revision,
    };
    for (const listener of this.listeners) {
      try { listener(signal); }
      catch { this.listeners.delete(listener); }
    }
  }
}
