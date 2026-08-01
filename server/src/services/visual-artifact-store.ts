export interface VisualArtifact {
  mimeType: 'image/png' | 'image/jpeg';
  data: Buffer;
  updatedAt: number;
}

/** Latest rendered frame per execution. Ownership stays with ExecutionObserver. */
export class VisualArtifactStore {
  private readonly frames = new Map<string, VisualArtifact>();

  publish(id: string, mimeType: VisualArtifact['mimeType'], data: Buffer): VisualArtifact {
    const frame = { mimeType, data, updatedAt: Date.now() };
    this.frames.set(id, frame);
    return frame;
  }

  get(id: string): VisualArtifact | undefined {
    return this.frames.get(id);
  }

  remove(id: string): void {
    this.frames.delete(id);
  }
}

export const visualArtifactStore = new VisualArtifactStore();
