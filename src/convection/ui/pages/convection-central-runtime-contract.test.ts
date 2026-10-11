import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

test('对流页面从中心探针读取运行态并通过中心命令中止', async () => {
  const source = await fs.readFile(path.resolve(
    'src/convection/ui/pages/ConvectionPage.tsx',
  ), 'utf8');
  assert.match(source, /readConvectionRound/);
  assert.match(source, /abortConvectionRound/);
  assert.doesNotMatch(source, /fetch\(`\/api\/convection\/session\/\$\{activeId\}\/abort`/);
  assert.doesNotMatch(source, /normalizeConvectionRound\(d\.activeRound\)/);
});
