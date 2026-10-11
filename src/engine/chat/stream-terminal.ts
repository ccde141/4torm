/** A socket close alone cannot establish that the execution completed. */
export class StreamTerminal {
  private state: 'open' | 'done' | 'error' = 'open';

  observe(type: string): void {
    if (type === 'done') this.state = 'done';
    else if (type === 'error') this.state = 'error';
  }

  assertClosed(aborted: boolean): void {
    if (!aborted && this.state === 'open') {
      throw new Error('流式连接在收到完成事件前关闭');
    }
  }
}

export function interruptedStreamContent(partial: string, reason: string): string {
  const notice = `(连接中断: ${reason})`;
  return partial ? `${partial}\n\n${notice}` : notice;
}
