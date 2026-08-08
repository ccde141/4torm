import { loadAgent } from '../shared/agent-loader.js';
import { callLLM } from '../shared/llm-bridge.js';

export function buildSeatCompactionPrompt(subject: string, summaryInput: string): string {
  return `将以下${subject}压缩为可供后续继续工作的结构化摘要。

只总结输入中真实出现的事实，不补写推测。工具调用、工具结果、文件路径、函数名、
错误原因、测试结果、用户约束和已否决方案都属于工作事实，不能只保留聊天正文。

## 输出格式
无内容的分区可以省略。

## Goal
当前目标与完成标准。

## Constraints & Preferences
用户约束、偏好、明确不改变项。

## Critical Context
恢复工作必须知道的环境、状态、错误与工具事实。

## Progress
### Done
### In Progress
### Blocked

## Key Decisions
已确认的方案、取舍与否决理由。

## Relevant Files
涉及的文件、模块、函数、提交或产物。

## Next Steps
尚待完成且已有依据的后续动作。

--- 待压缩上下文 ---
${summaryInput}`;
}

export async function resolveSeatCompactionModel(
  dataDir: string,
  agentId: string,
): Promise<string> {
  const agent = await loadAgent(dataDir, agentId);
  if (!agent) throw new Error('摘要 Agent 不存在');
  if (!agent.model) throw new Error('摘要 Agent 未配置模型');
  return agent.model;
}

export async function generateSeatCompactionSummary(params: {
  dataDir: string;
  fullModelKey: string;
  subject: string;
  summaryInput: string;
  signal?: AbortSignal;
  onChunk?: (chunk: string) => void;
}): Promise<string> {
  const prompt = buildSeatCompactionPrompt(params.subject, params.summaryInput);
  const result = await callLLM({
    dataDir: params.dataDir,
    fullModelKey: params.fullModelKey,
    messages: [
      {
        role: 'system',
        content: '你是 4torm 气旋工作室的上下文压缩器。输出中文，精炼、准确、可继续工作。',
      },
      { role: 'user', content: prompt },
    ],
    options: { temperature: 0.1, maxTokens: 10_000 },
    signal: params.signal,
    onChunk: params.onChunk,
  });
  return result.content.trim();
}
