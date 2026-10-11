import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

test('气旋流保存中心签发的执行身份并只通过中心路由中止', async () => {
  const [seat, room] = await Promise.all([
    fs.readFile(path.resolve('src/cyclone/ui/pages/useSeatStreamRunners.ts'), 'utf8'),
    fs.readFile(path.resolve('src/cyclone/ui/pages/useRoomStreamRunners.ts'), 'utf8'),
  ]);
  for (const source of [seat, room]) {
    assert.match(source, /ev\.type === 'execution-start'/);
    assert.match(source, /runner\.operationId = ev\.operationId/);
    assert.match(source, /runner\.runId = ev\.runId/);
    assert.match(source, /abortCycloneExecution\([a-z]+\.operationId!, [a-z]+\.runId!\)/);
    assert.doesNotMatch(source, /api\/cyclone[^'"`]*\/abort/);
  }
});
