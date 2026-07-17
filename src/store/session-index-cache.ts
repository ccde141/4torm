export class MissingIndexReadCache<T> {
  private readonly missing = new Set<string>();
  private readonly inflight = new Map<string, Promise<T | null>>();
  private readonly versions = new Map<string, number>();

  read(key: string, loader: () => Promise<T | null>): Promise<T | null> {
    if (this.missing.has(key)) return Promise.resolve(null);
    const current = this.inflight.get(key);
    if (current) return current;
    const version = this.versions.get(key) ?? 0;
    const request = loader()
      .then(value => {
        if (value === null && (this.versions.get(key) ?? 0) === version) this.missing.add(key);
        return value;
      })
      .finally(() => {
        if (this.inflight.get(key) === request) this.inflight.delete(key);
      });
    this.inflight.set(key, request);
    return request;
  }

  invalidate(key: string): void {
    this.missing.delete(key);
    this.versions.set(key, (this.versions.get(key) ?? 0) + 1);
  }
}
