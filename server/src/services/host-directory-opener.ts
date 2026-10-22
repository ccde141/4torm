import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { frameworkError } from '../engine/shared/framework-error.js';

type DirectorySpawn = (command: string, args: string[], options: SpawnOptions) => ChildProcess;

/** 启动服务宿主机的目录打开程序；不代表在远端客户端打开了目录。 */
export function openHostDirectory(
  directory: string, launch: DirectorySpawn = spawn,
): Promise<void> {
  const command = process.platform === 'win32' ? 'explorer.exe'
    : process.platform === 'darwin' ? 'open' : 'xdg-open';
  return new Promise<void>((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = launch(command, [directory], { detached: true, stdio: 'ignore' });
    } catch (error) {
      reject(openFailure(command, error));
      return;
    }
    // 必须先确认程序启动；ENOENT 不能在接口已返回成功后成为无人处理的事件。
    child.once('error', error => reject(openFailure(command, error)));
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}

function openFailure(command: string, cause: unknown): Error {
  const unavailable = cause instanceof Error && (cause as NodeJS.ErrnoException).code === 'ENOENT';
  return frameworkError({
    code: 'HOST_DIRECTORY_OPEN_FAILED', kind: 'io',
    message: unavailable ? `服务宿主机未提供 ${command}，无法打开目录`
      : '无法在服务宿主机启动目录打开程序',
    source: 'host.directory', retryable: false,
  }, { cause });
}
