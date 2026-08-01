export type ExecutionSurfaceRenderMode = 'terminal' | 'visual' | 'native-when-embedded';

export interface ExecutionSurfaceLifecycleSemantics {
  endpoint: 'terminate' | 'close';
  actionLabel: string;
  pendingLabel: string;
  confirmTitle: string;
  confirmLabel: string;
  confirmMessage: string;
  waitingConfirmMessage?: string;
  failureMessage?: string;
}

export interface ExecutionSurfaceCapability {
  viewer: string;
  renderMode: ExecutionSurfaceRenderMode;
  retainAfterCompletion: boolean;
  fallbackLabel: string;
  commandPrefix?: RegExp;
  lifecycle: ExecutionSurfaceLifecycleSemantics;
}

/** UI metadata only: process ownership and lifecycle facts remain server-owned. */
export class ExecutionSurfaceCapabilityRegistry {
  private readonly capabilities = new Map<string, ExecutionSurfaceCapability>();

  register(capability: ExecutionSurfaceCapability): void {
    if (this.capabilities.has(capability.viewer)) {
      throw new Error(`execution surface capability ${capability.viewer} is already registered`);
    }
    this.capabilities.set(capability.viewer, capability);
  }

  find(viewer: string): ExecutionSurfaceCapability | undefined {
    return this.capabilities.get(viewer);
  }

  require(viewer: string): ExecutionSurfaceCapability {
    const capability = this.find(viewer);
    if (!capability) throw new Error(`execution surface capability ${viewer} is not registered`);
    return capability;
  }
}

const terminateLifecycle: ExecutionSurfaceLifecycleSemantics = {
  endpoint: 'terminate',
  actionLabel: '终止运行',
  pendingLabel: '正在终止…',
  confirmTitle: '终止这项运行？',
  confirmLabel: '确认终止',
  confirmMessage: '终止后，当前运行及其子进程会立即结束，且无法撤销。',
  failureMessage: '无法终止运行',
};

export const executionSurfaceCapabilities = new ExecutionSurfaceCapabilityRegistry();
executionSurfaceCapabilities.register({
  viewer: 'terminal', renderMode: 'terminal', retainAfterCompletion: true,
  fallbackLabel: '终端', lifecycle: terminateLifecycle,
});
executionSurfaceCapabilities.register({
  viewer: 'browser', renderMode: 'native-when-embedded', retainAfterCompletion: false,
  fallbackLabel: '浏览器', commandPrefix: /^(?:4torm\s+)?Browser:\s*/i,
  lifecycle: {
    endpoint: 'close',
    actionLabel: '结束浏览器',
    pendingLabel: '正在结束…',
    confirmTitle: '结束这个浏览器？',
    confirmLabel: '确认结束',
    confirmMessage: '结束后，浏览器任务及当前页面状态会被关闭，且无法撤销。',
    waitingConfirmMessage: 'Agent 正在等待你操作。结束后，当前浏览器及页面状态会被关闭。',
    failureMessage: '无法结束浏览器',
  },
});
executionSurfaceCapabilities.register({
  viewer: 'computer', renderMode: 'visual', retainAfterCompletion: true,
  fallbackLabel: '电脑操作', lifecycle: terminateLifecycle,
});

export function findExecutionSurfaceCapability(viewer?: string): ExecutionSurfaceCapability | undefined {
  return executionSurfaceCapabilities.find(viewer ?? 'terminal');
}

export function getExecutionSurfaceCapability(viewer?: string): ExecutionSurfaceCapability {
  return executionSurfaceCapabilities.require(viewer ?? 'terminal');
}
