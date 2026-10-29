import { estimateCurrentInput } from '../shared/llm-bridge.js';
import type { ContextMessage } from '../shared/types.js';
import type { ToolDef } from '../shared/tool-defs-loader.js';
import type { CurrentInputEstimate } from '../shared/model-request-usage.js';

/** Observes the runner-owned context, never the separately saved display transcript. */
export class ConversationContextObservation {
  private context: ContextMessage[] = [];
  private tools: ToolDef[] = [];
  private tail?: ContextMessage;
  private tailIndex = 0;
  private revision = 0;
  get ready(): boolean { return this.revision > 0; }
  constructor(private readonly dataDir: string, private readonly model: string,
    private readonly runId: string, private readonly emit: (estimate: CurrentInputEstimate) => void) {}

  async update(context: ContextMessage[], tools: ToolDef[], tail?: ContextMessage): Promise<void> {
    this.context = context; this.tools = tools; this.tail = tail;
    this.tailIndex = context.length; this.revision++;
    this.emit(await this.read());
  }

  async read(): Promise<CurrentInputEstimate> {
    const retained = this.context[this.tailIndex];
    const included = this.tail && retained?.role === 'assistant' && retained.content === this.tail.content
      && JSON.stringify(retained.toolCalls) === JSON.stringify(this.tail.toolCalls);
    const context = [...this.context, ...(this.tail && !included ? [this.tail] : [])];
    const revision = this.revision;
    const estimate = await estimateCurrentInput({ dataDir: this.dataDir, fullModelKey: this.model,
      messages: context, ...(this.tools.length ? { tools: this.tools } : {}) });
    return { ...estimate, runId: this.runId, active: true, contextRevision: `${this.runId}:${revision}` };
  }
}
