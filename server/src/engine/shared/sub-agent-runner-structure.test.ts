import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const files = [
  path.join(here, 'sub-agent-runner.ts'),
  path.join(here, '../tradewind/execution/sub-agent-runner.ts'),
  path.join(here, 'native-sub-agent-runner.ts'),
  path.join(here, 'text-sub-agent-executor.ts'),
];

for (const file of files) {
  const source = fs.readFileSync(file, 'utf-8');
  assert.doesNotMatch(source, /<action|<answer|<think|<result/);
  assert.doesNotMatch(source, /parseAction|hasUnclosedAction|hasUnparsedActions|buildToolProtocol/);
  assert.ok(source.split(/\r?\n/).length <= 300, `${path.basename(file)} 超过 300 行`);
}

for (const file of files.slice(0, 2)) {
  const source = fs.readFileSync(file, 'utf-8');
  assert.match(source, /export async function runSubAgent\(/);
}

console.log('sub-agent runner structure ok');
