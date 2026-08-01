import assert from 'node:assert/strict';
import test from 'node:test';
import {
  detectSystemEdge,
  defaultBrowserEngine,
  edgeExecutableCandidates,
  normalizeBrowserEngine,
  resolveBrowserLaunch,
} from './browser-engine.js';

test('defaults Windows to system Edge and other platforms to isolated Chromium', () => {
  assert.equal(defaultBrowserEngine('win32'), 'system-edge');
  assert.equal(defaultBrowserEngine('linux'), 'playwright-chromium');
  assert.equal(normalizeBrowserEngine(undefined, 'win32'), 'system-edge');
});

test('rejects an unknown browser engine', () => {
  assert.equal(normalizeBrowserEngine('chrome'), undefined);
});

test('detects Edge from the first available Windows installation path', async () => {
  const paths = edgeExecutableCandidates({
    ProgramFiles: 'C:\\Program Files',
    'ProgramFiles(x86)': 'C:\\Program Files (x86)',
    LOCALAPPDATA: 'C:\\Users\\person\\AppData\\Local',
  });
  const edge = await detectSystemEdge(paths, async candidate => candidate === paths[1]);

  assert.equal(edge, paths[1]);
});

test('reports Edge as unavailable when none of its executable paths exist', async () => {
  const edge = await detectSystemEdge(['C:\\missing\\msedge.exe'], async () => false);

  assert.equal(edge, undefined);
});

test('uses the explicitly detected Edge executable without falling back', async () => {
  const launch = await resolveBrowserLaunch('system-edge', ['C:\\Edge\\msedge.exe'], async () => true);

  assert.deepEqual(launch, { executablePath: 'C:\\Edge\\msedge.exe' });
});

test('fails truthfully when system Edge was requested but is unavailable', async () => {
  await assert.rejects(
    () => resolveBrowserLaunch('system-edge', ['C:\\missing\\msedge.exe'], async () => false),
    /Microsoft Edge is not available/,
  );
});
