import assert from 'node:assert/strict';
import test from 'node:test';
import { renderTerminalLines, renderTerminalOutput } from './terminal-output';

test('terminal output keeps only the latest carriage-return progress line', () => {
  assert.equal(renderTerminalOutput([
    { stream: 'stdout', text: 'Downloading 10%\r' },
    { stream: 'stdout', text: 'Downloading 100%\nDone\n' },
  ]), 'Downloading 100%\nDone\n');
});

test('terminal output preserves the order of stdout and stderr chunks', () => {
  assert.equal(renderTerminalOutput([
    { stream: 'stdout', text: 'Installing\n' },
    { stream: 'stderr', text: 'warning: optional dependency\n' },
  ]), 'Installing\nwarning: optional dependency\n');
});

test('terminal lines retain stderr provenance in the shared output timeline', () => {
  assert.deepEqual(renderTerminalLines([
    { stream: 'stdout', text: 'Installing\n' },
    { stream: 'stderr', text: 'error: package failed\n' },
  ]), [
    { stream: 'stdout', text: 'Installing' },
    { stream: 'stderr', text: 'error: package failed' },
  ]);
});
