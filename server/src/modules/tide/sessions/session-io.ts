import { randomUUID } from 'node:crypto';
import type { Stats } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { frameworkError } from '../../../engine/shared/framework-error.js';

export function ambiguousTideSession(sessionId: string) {
  return frameworkError({ code: 'TIDE_SESSION_AMBIGUOUS', kind: 'conflict',
    message: '潮汐旧会话标识对应多个任务，无法确定归属',
    source: 'tide.sessions', retryable: false, details: { sessionId } });
}

export async function readSessionJson<T>(file: string, label: string): Promise<T | null> {
  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch (error) {
    if (isMissing(error)) return null;
    throw sessionIoError('TIDE_SESSION_READ_FAILED', `无法读取${label}`, file, error);
  }
  try {
    return JSON.parse(stripBom(raw)) as T;
  } catch (error) {
    const quarantined = await quarantine(file);
    throw frameworkError({
      code: 'TIDE_SESSION_CORRUPT', kind: 'protocol',
      message: quarantined ? `${label}损坏，原文件已隔离` : `${label}损坏，且无法隔离原文件`,
      source: 'tide.session-store', retryable: false,
      details: { file: path.basename(file), quarantined },
    }, { cause: error });
  }
}

export async function readSessionDir(dir: string, label: string): Promise<string[] | null> {
  try {
    return await fs.readdir(dir);
  } catch (error) {
    if (isMissing(error)) return null;
    throw sessionIoError('TIDE_SESSION_DIR_READ_FAILED', `无法读取${label}`, dir, error);
  }
}

export async function statSessionPath(target: string, label: string): Promise<Stats | null> {
  try {
    return await fs.stat(target);
  } catch (error) {
    if (isMissing(error)) return null;
    throw sessionIoError('TIDE_SESSION_STAT_FAILED', `无法检查${label}`, target, error);
  }
}

export async function removeSessionPath(
  target: string,
  options: { recursive?: boolean } = {},
): Promise<boolean> {
  try {
    await fs.rm(target, { recursive: options.recursive ?? false, force: false });
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw sessionIoError('TIDE_SESSION_DELETE_FAILED', '无法删除潮汐会话数据', target, error);
  }
}

async function quarantine(file: string): Promise<boolean> {
  const suffix = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
  try {
    await fs.rename(file, `${file}.corrupt-${suffix}`);
    return true;
  } catch {
    return false;
  }
}

function sessionIoError(code: string, message: string, target: string, cause: unknown) {
  return frameworkError({
    code, kind: 'io', message, source: 'tide.session-store', retryable: false,
    details: { path: path.basename(target) },
  }, { cause });
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

function stripBom(raw: string): string {
  return raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
}
