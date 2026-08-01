import fs from 'node:fs/promises';
import path from 'node:path';

export type BrowserEngine = 'playwright-chromium' | 'system-edge';

type WindowsEnvironment = Partial<Record<'ProgramFiles' | 'ProgramFiles(x86)' | 'LOCALAPPDATA', string>>;
type CanAccess = (file: string) => Promise<boolean>;

export function defaultBrowserEngine(platform: NodeJS.Platform = process.platform): BrowserEngine {
  return platform === 'win32' ? 'system-edge' : 'playwright-chromium';
}

export function normalizeBrowserEngine(value: unknown, platform: NodeJS.Platform = process.platform): BrowserEngine | undefined {
  if (value === undefined) return defaultBrowserEngine(platform);
  return value === 'playwright-chromium' || value === 'system-edge' ? value : undefined;
}

export function edgeExecutableCandidates(environment: WindowsEnvironment = process.env): string[] {
  const roots = [environment.ProgramFiles, environment['ProgramFiles(x86)'], environment.LOCALAPPDATA]
    .filter((root): root is string => Boolean(root));
  return [...new Set(roots.map(root => path.join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe')))];
}

export async function detectSystemEdge(
  candidates = edgeExecutableCandidates(),
  canAccess: CanAccess = canAccessFile,
): Promise<string | undefined> {
  for (const candidate of candidates) {
    if (await canAccess(candidate)) return candidate;
  }
  return undefined;
}

export async function resolveBrowserLaunch(
  engine: BrowserEngine,
  candidates = edgeExecutableCandidates(),
  canAccess: CanAccess = canAccessFile,
): Promise<{ executablePath?: string }> {
  if (engine === 'playwright-chromium') return {};
  const executablePath = await detectSystemEdge(candidates, canAccess);
  if (!executablePath) throw new Error('Microsoft Edge is not available on this computer');
  return { executablePath };
}

async function canAccessFile(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}
