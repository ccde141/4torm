/**
 * Output 节点执行器 —— 工作流终点 + transcripts 归档
 *
 * 行为：
 * - waitForInputs() 等待所有 handoff 入线到齐
 * - 收集所有节点对话历史 + 会议记录 → 生成 Markdown 归档
 * - 写入 workspace/transcripts/{archiveName}.md
 * - emit WORK_DONE（orchestrator 在 handleNodeDone 里触发 workflow-end）
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

    // 归档输出内容（保留原有逻辑）
    const outputData = envelopes.map(e => ({
      source: e.source,
      content: e.content,
      timestamp: e.timestamp,
    }));
    const outputPath = path.join(ctx.runDir, 'output.json');
    try {
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      await fs.writeFile(outputPath, JSON.stringify(outputData, null, 2));
    } catch { /* 静默 */ }

    // Checkpoint 归档：收集所有节点历史 → Markdown
    await this.writeCheckpoint(ctx, envelopes);

    ctx.emit(BUILTIN_EVENT_IDS.WORK_DONE);
    ctx.setState('idle');
  }

  private async writeCheckpoint(ctx: ExecutionContext, envelopes: any[]): Promise<void> {
    try {
      const config = ctx.nodeConfig as { archiveName?: string };
      const now = new Date();
      const localStamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}`;
      const name = config.archiveName?.trim() || localStamp;

      // 确定归档目录（workspace/transcripts/）
      const projectDir = path.resolve(ctx.dataDir, '..');
      const workspaceRel = `data/tradewind/workflows/${ctx.workflowId}/workspace`;
      const transcriptsDir = path.join(projectDir, workspaceRel, 'transcripts');
      await fs.mkdir(transcriptsDir, { recursive: true });

      // 收集所有节点的 messages
      const nodesDir = path.join(ctx.runDir, 'nodes');
      const nodeEntries = await fs.readdir(nodesDir).catch(() => [] as string[]);
      const nodeHistories: Array<{ nodeId: string; label: string; messages: ContextMessage[] }> = [];
      for (const nodeId of nodeEntries) {
        const msgPath = path.join(nodesDir, nodeId, 'messages.json');
        try {
          const raw = await fs.readFile(msgPath, 'utf-8');
          const messages: ContextMessage[] = JSON.parse(raw);
          const label = ctx.nodeLabelMap[nodeId] || nodeId;
          nodeHistories.push({ nodeId, label, messages });
        } catch { /* 节点无历史或文件损坏 */ }
      }

      // 收集会议记录
      const meetingsDir = path.join(ctx.runDir, 'meetings');
      const meetingFiles = await fs.readdir(meetingsDir).catch(() => [] as string[]);
      const meetings: Array<{ fileName: string; messages: any[] }> = [];
      for (const f of meetingFiles) {
        if (!f.endsWith('.json')) continue;
        try {
          const raw = await fs.readFile(path.join(meetingsDir, f), 'utf-8');
          meetings.push({ fileName: f.replace('.json', ''), messages: JSON.parse(raw) });
        } catch { /* 跳过 */ }
      }

      // 收集 output 信封内容
      const outputContent = envelopes.map(e => e.content).join('\n\n---\n\n');

      // 生成 Markdown
      const md = this.formatMarkdown(ctx, nodeHistories, meetings, outputContent);

      // 写入归档
      const filePath = path.join(transcriptsDir, `${name}.md`);
      await fs.writeFile(filePath, md);
    } catch (err) {
      console.warn('[output] transcripts archive failed:', (err as Error).message);
    }
  }

  private formatMarkdown(
    ctx: ExecutionContext,
    nodes: Array<{ nodeId: string; label: string; messages: ContextMessage[] }>,
    meetings: Array<{ fileName: string; messages: any[] }>,
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

    // 解析结构化标签
    const thinkMatch = content.match(/<think(?:ing)?>([\s\S]*?)<\/think(?:ing)?>/i);
    const answerMatch = content.match(/<answer>([\s\S]*?)<\/answer>/i);
    const noteMatch = content.match(/<note>([\s\S]*?)<\/note>/i);
    const actionMatches = [...content.matchAll(/<action\s+[^>]*?tool\s*=\s*"([^"]+)"[^>]*>([\s\S]*?)<\/action>/gi)];

    // 有结构化标签的 assistant 消息
    if (role === 'assistant' && (thinkMatch || answerMatch || actionMatches.length > 0)) {
      const parts: string[] = [];

      if (thinkMatch) {
        parts.push(`<details>\n<summary>💭 思考过程</summary>\n\n${thinkMatch[1].trim()}\n\n</details>`);
      }

      for (const am of actionMatches) {
        const tool = am[1];
        const args = am[2].trim();
        parts.push(`<details>\n<summary>🔧 ${tool}</summary>\n\n\`\`\`json\n${args}\n\`\`\`\n\n</details>`);
      }

      if (answerMatch) {
        parts.push(answerMatch[1].trim());
      } else {
        // 无 answer 标签：剥离已处理的标签，输出剩余内容
        let remainder = content;
        remainder = remainder.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '');
        remainder = remainder.replace(/<action[^>]*>[\s\S]*?<\/action>/gi, '');
        remainder = remainder.replace(/<note>[\s\S]*?<\/note>/gi, '');
        remainder = remainder.replace(/<\/?(?:think(?:ing)?|action|answer|note)[^>]*>/gi, '').trim();
        if (remainder) parts.push(remainder);
      }

      if (noteMatch) {
        parts.push(`> 💡 ${noteMatch[1].trim()}`);
      }

      return `**[助手]**\n\n${parts.join('\n\n')}`;
    }

    // 普通消息
    const roleLabel = role === 'user' ? '人类' : role === 'system' ? '系统' : '助手';
    // 运行时 system 消息（信封、纪要广播等）以引用块展示
    if (role === 'system') {
      return `> 📨 ${content.split('\n')[0]}\n${content.split('\n').slice(1).map(l => `> ${l}`).join('\n')}`;
    }
    return `**[${roleLabel}]** ${content}`;
  }
}
