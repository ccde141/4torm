export interface ToolDispatchHandler<TInput, TResult> {
  id: string;
  matches(tool: string): boolean;
  execute(tool: string, input: TInput): Promise<TResult>;
}

export class ToolDispatchRegistry<TInput, TResult> {
  constructor(private readonly handlers: readonly ToolDispatchHandler<TInput, TResult>[]) {}

  async dispatch(
    tool: string,
    input: TInput,
    fallback: (tool: string, input: TInput) => Promise<TResult>,
  ): Promise<TResult> {
    const matches = this.handlers.filter(handler => handler.matches(tool));
    if (matches.length > 1) {
      throw new Error(`TOOL_HANDLER_AMBIGUOUS:${tool}:${matches.map(match => match.id).join(',')}`);
    }
    return matches[0]?.execute(tool, input) ?? fallback(tool, input);
  }
}
