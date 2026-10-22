import { constants } from 'node:fs';
import { copyFile, mkdir, readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';

async function seedMissingFiles(source, target) {
  await mkdir(target, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isDirectory()) await seedMissingFiles(from, to);
    else if (entry.isFile()) {
      // Existing user executors, skills and configuration always take precedence on restart.
      try { await copyFile(from, to, constants.COPYFILE_EXCL); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
  }
}

await seedMissingFiles('/app/seed-data', process.env.FOURTORM_DATA_DIR || '/app/data');
const child = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'src/index.ts'], {
  cwd: '/app/server', stdio: 'inherit', env: process.env,
});
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));
child.on('error', error => { console.error('后端进程未能启动：', error.message); process.exitCode = 1; });
child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
