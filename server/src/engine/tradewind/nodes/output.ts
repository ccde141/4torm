/**
 * Output 节点执行器 —— 工作流终点 + transcripts 归档
 *
 * 行为：
 * - waitForInputs() 等待所有 handoff 入线到齐
 * - 原子提交 output.json 和 workspace/transcripts/{archiveName}.md
 * - 归档失败报告给编排器，不发布成功事件、不重新执行模型
 *
 * 配置项：
 * - archiveName: string（可选，归档文件名，默认时间戳）
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  NodeExecutor,
  ExecutionContext,
  InputKind,
  OutputKind,
  EventTypeDef,
  JSONSchema,
} from '../foundation/types';
import { BUILTIN_EVENT_IDS } from '../foundation/types';
import type { ContextMessage } from '../../shared/types';
import { atomicWriteFile } from '../../shared/atomic-io.js';
import { frameworkError } from '../../shared/framework-error.js';
import { readOutputMeetings, readOutputNodeHistories,
  type OutputMeetingHistory, type OutputNodeHistory } from './output-archive-reader.js';

function formatAssistantMessage(msg: ContextMessage): string {
  if (!msg.reasoningContent && !msg.toolCalls?.length) {
    return `**[助手]** ${msg.content}`;
  }

  const parts: string[] = [];
  if (msg.reasoningContent) {
    parts.push(`<details>\n<summary>💭 思考过程</summary>\n\n${msg.reasoningContent}\n\n</details>`);
  }
  for (const call of msg.toolCalls || []) {
    parts.push(
      `<details>\n<summary>🔧 ${call.name}</summary>\n\n\`\`\`json\n${call.arguments}\n\`\`\`\n\n</details>`,
    );
  }
  if (msg.content) parts.push(msg.content);
  return `**[助手]**\n\n${parts.join('\n\n')}`;
}

export class OutputExecutor implements NodeExecutor {
  readonly type = 'output';
  readonly category = 'flow';
  readonly label = '出口';
  readonly inputKinds: InputKind[] = ['work'];
  readonly outputKinds: OutputKind[] = ['none'];
  readonly events: EventTypeDef[] = [];

  configSchema(): JSONSchema {
    return {
      type: 'object',
      properties: {
        archiveName: {
          type: 'string',
          description: '归档文件名（不含后缀），留空则使用时间戳',
        },
      },
    };
  }

  validateConfig(): boolean {
    return true;
  }

  async execute(ctx: ExecutionContext): Promise<void> {
    ctx.setState('active');
    const envelopes = await ctx.waitForInputs();

    // 写入本轮输出信封。
    const outputData = envelopes.map(e => ({
      source: e.source,
      content: e.content,
      timestamp: e.timestamp,
    }));
    const outputPath = path.join(ctx.runDir, 'output.json');
    try {
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      await atomicWriteFile(outputPath, JSON.stringify(outputData, null, 2));
      await this.writeCheckpoint(ctx, envelopes);
    } catch (cause) {
      throw frameworkError({ code: 'TRADEWIND_OUTPUT_ARCHIVE_FAILED', kind: 'io',
        message: '信风交付归档未能完整保存，请检查执行记录；不会自动重新执行工作流',
        source: 'tradewind.output', retryable: false,
        details: { workflowId: ctx.workflowId, executionId: ctx.executionId, nodeId: ctx.nodeId },
      }, { cause });
    }

    await ctx.emit(BUILTIN_EVENT_IDS.WORK_DONE);
    ctx.setState('idle');
  }

  private async writeCheckpoint(
    ctx: ExecutionContext, envelopes: import('../foundation/types').Envelope[],
  ): Promise<void> {
    const config = ctx.nodeConfig as { archiveName?: string };
    const now = new Date();
    const localStamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}`;
    const name = config.archiveName?.trim() || localStamp;

    // 确定归档目录（workspace/transcripts/）
    const transcriptsDir = path.join(ctx.dataDir, 'tradewind', 'workflows',
      ctx.workflowId, 'workspace', 'transcripts');
    await fs.mkdir(transcriptsDir, { recursive: true });

    const nodeHistories = await readOutputNodeHistories(ctx.runDir, ctx.nodeLabelMap);
    const meetings = await readOutputMeetings(ctx.runDir);

    // 收集 output 信封内容
    const outputContent = envelopes.map(e => e.content).join('\n\n---\n\n');

    // 生成 Markdown
    const md = this.formatMarkdown(ctx, nodeHistories, meetings, outputContent);

    // 写入归档
    const filePath = path.join(transcriptsDir, `${name}.md`);
    await atomicWriteFile(filePath, md);
  }

  private formatMarkdown(
    ctx: ExecutionContext,
    nodes: OutputNodeHistory[],
    meetings: OutputMeetingHistory[],
    outputContent: string,
  ): string {
    const now = new Date();
    const localTime = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
    const lines: string[] = [];

    lines.push(`# 工作流归档`);
    lines.push(``);
    lines.push(`> 执行 ID：${ctx.executionId}`);
    lines.push(`> 归档时间：${localTime}`);
    lines.push(`> 工作流 ID：${ctx.workflowId}`);
    lines.push(``);
    lines.push(`---`);

    // 各节点对话历史
    for (const node of nodes) {
      lines.push(``);
      lines.push(`## ${node.label}`);
      lines.push(``);
      // 跳过第一条 system 消息（框架 system prompt，用户不需要看）
      const msgs = node.messages;
      const startIdx = (msgs.length > 0 && msgs[0].role === 'system') ? 1 : 0;
      for (let i = startIdx; i < msgs.length; i++) {
        const formatted = this.formatMessage(msgs[i]);
        if (formatted) {
          lines.push(formatted);
          lines.push(``);
        }
      }
      lines.push(`---`);
    }

    // 会议记录
    for (const meeting of meetings) {
      lines.push(``);
      lines.push(`## 会议记录：${meeting.fileName}`);
      lines.push(``);
      for (const m of meeting.messages) {
        const speaker = m.speaker || '未知';
        const content = m.content || '';
        lines.push(`**[${speaker}]** ${content}`);
        lines.push(``);
      }
      lines.push(`---`);
    }

    // Output 最终交付
    lines.push(``);
    lines.push(`## 最终交付（Output）`);
    lines.push(``);
    lines.push(outputContent);
    lines.push(``);

    return lines.join('\n');
  }

  private formatMessage(msg: ContextMessage): string {
    const role = msg.role;
    const content = msg.content;
    if (role === 'assistant') return formatAssistantMessage(msg);
    const roleLabel = role === 'user' ? '人类' : role === 'system' ? '系统' : '助手';
    // 运行时 system 消息（信封、纪要广播等）以引用块展示
    if (role === 'system') {
      return `> 📨 ${content.split('\n')[0]}\n${content.split('\n').slice(1).map(l => `> ${l}`).join('\n')}`;
    }
    return `**[${roleLabel}]** ${content}`;
  }
}
