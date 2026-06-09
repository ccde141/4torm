/**
 * 归档路径工厂 —— 统一管理 runs/{wfId}/{execId}/ 下的二级路径
 *
 * 设计依据：tradewind-build-guide.md §6.5 归档路径规范
 *
 * 职责边界：
 * - 本文件只管 runDir 之下的相对路径计算，不管 runDir 本身（那由 runner.ts 算）
 * - 所有需要 nodeId、tool 名等的路径合法化也在这里完成
 *
 * 当前提供：
 * - tool-calls 目录与文件名（5.3）
 * - contexts 目录与文件名（5.3 workflow-end dump）
 * - sub-agent 归档目录组（5.5a：母节点维度的 sub-agents/{subId}/...）
 */

import path from 'node:path';

/** 替换文件系统不安全字符。与沙盒/tool-bridge 一致。 */
function sanitizePathToken(token: string): string {
  if (!token) return '_';
  return token.replace(/[\\/:*?"<>| ]/g, '_').replace(/\.\.+/g, '_');
}

/** 工具调用归档目录：{runDir}/tool-calls/{nodeId}/ */
export function getToolCallsDir(runDir: string, nodeId: string): string {
  return path.join(runDir, 'tool-calls', sanitizePathToken(nodeId));
}

/**
 * 工具调用单次记录文件名：{timestamp}-{seq}-{tool}.json
 * seq 用于规避同毫秒并发调用同工具时的文件名冲突。
 */
export function getToolCallFileName(timestamp: number, seq: number, tool: string): string {
  return `${timestamp}-${seq}-${sanitizePathToken(tool)}.json`;
}

/** Agent 节点上下文 dump 目录：{runDir}/contexts/ */
export function getContextsDir(runDir: string): string {
  return path.join(runDir, 'contexts');
}

/** Agent 节点上下文 dump 文件名：{nodeId}.json */
export function getContextFileName(nodeId: string): string {
  return `${sanitizePathToken(nodeId)}.json`;
}

// ── 5.5a：Sub-Agent 归档路径 ───────────────────────────────

/**
 * 单个 sub-agent 的根目录：{runDir}/nodes/{母nodeId}/sub-agents/{subId}/
 *
 * 设计依据：AGENTS.md §5.5 决策清单 + B4。
 * 注意比 contexts/ 多一层 nodes/{母nodeId}/，是为了让多母 Agent 各派子时不互相覆盖。
 */
export function getSubAgentDir(runDir: string, parentNodeId: string, subId: string): string {
  return path.join(
    runDir,
    'nodes', sanitizePathToken(parentNodeId),
    'sub-agents', sanitizePathToken(subId),
  );
}

/** sub-agent 自己的 events.jsonl 路径 */
export function getSubAgentEventsFile(runDir: string, parentNodeId: string, subId: string): string {
  return path.join(getSubAgentDir(runDir, parentNodeId, subId), 'events.jsonl');
}

/** sub-agent 自己的 meta.json 路径 */
export function getSubAgentMetaFile(runDir: string, parentNodeId: string, subId: string): string {
  return path.join(getSubAgentDir(runDir, parentNodeId, subId), 'meta.json');
}

/** sub-agent 自己的 context.json（messages dump）路径 */
export function getSubAgentContextFile(runDir: string, parentNodeId: string, subId: string): string {
  return path.join(getSubAgentDir(runDir, parentNodeId, subId), 'context.json');
}

/**
 * sub-agent 的 tool-calls 目录：{subDir}/tool-calls/
 * 注意：不再按 nodeId 二次分层，因为该目录已经在 sub-agent 自己的根下。
 */
export function getSubAgentToolCallsDir(runDir: string, parentNodeId: string, subId: string): string {
  return path.join(getSubAgentDir(runDir, parentNodeId, subId), 'tool-calls');
}

// ── 6.2i：Meeting 归档路径 ───────────────────────────────

/** 会议记录归档目录：{runDir}/meetings/ */
export function getMeetingsDir(runDir: string): string {
  return path.join(runDir, 'meetings');
}

/** 会议记录归档文件名：{meetingNodeId}-{round}.json */
export function getMeetingFileName(meetingNodeId: string, round: number): string {
  return `${sanitizePathToken(meetingNodeId)}-${round}.json`;
}
