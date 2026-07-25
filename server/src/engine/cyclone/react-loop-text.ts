import { runReActLoop as runSharedTextLoop } from '../conversation/react-loop-text.js';
import type { ReActLoopParams, ReActLoopResult } from './react-loop.js';

export function runReActLoop(params: ReActLoopParams): Promise<ReActLoopResult> {
  return runSharedTextLoop(params);
}
