/** 按 taskId 防止同一潮汐任务被定时 tick 与手动触发重复执行。 */
export class TideTaskRunGate {
  private readonly running = new Set<string>();

  async run<T>(taskId: string, work: () => Promise<T>): Promise<T | undefined> {
    if (this.running.has(taskId)) return undefined;
    this.running.add(taskId);
    try {
      return await work();
    } finally {
      this.running.delete(taskId);
    }
  }

  has(taskId: string): boolean {
    return this.running.has(taskId);
  }
}
