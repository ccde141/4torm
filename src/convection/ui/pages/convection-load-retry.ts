const STARTUP_RETRY_DELAYS = [200, 400, 800, 1_200, 2_000] as const;
const RETRYABLE_STATUS = new Set([500, 502, 503, 504]);

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 对流只读加载的启动恢复策略。
 *
 * Electron 已负责等待后端，但上一次未完整退出时，旧窗口仍可能短暂早于
 * 新后端恢复。这里只重试 GET 读取；创建、发送、编辑、删除绝不走此函数。
 */
export async function fetchConvectionRead(
  input: RequestInfo | URL,
  fetcher: typeof fetch = fetch,
  waitForRetry: (ms: number) => Promise<void> = wait,
): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetcher(input);
      if (!RETRYABLE_STATUS.has(response.status) || attempt >= STARTUP_RETRY_DELAYS.length) {
        return response;
      }
    } catch (error) {
      if (!(error instanceof TypeError) || attempt >= STARTUP_RETRY_DELAYS.length) throw error;
    }
    await waitForRetry(STARTUP_RETRY_DELAYS[attempt]);
  }
}
