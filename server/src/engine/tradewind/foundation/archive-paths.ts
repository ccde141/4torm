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
 * - meetings 目录与文件名（6.2i：会议记录归档）
 */

import path from 'node:path';

/** 替换文件系统不安全字符。与沙盒/tool-bridge 一致。 */
function sanitizePathToken(token: string): string {
  if (!token) return '_';
  return token.replace(/[\\/:*?"<>| ]/g, '_').replace(/\.\.+/g, '_');
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
