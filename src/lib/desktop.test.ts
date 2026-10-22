import assert from 'node:assert/strict';
import test from 'node:test';
import { filePath, getDesktopExecutionSurface, type DesktopBridge } from './desktop';

test('remote desktop files upload bytes without disclosing client paths to the backend', () => {
  const file = new File(['contents'], 'report.txt');
  let pathReads = 0;
  const local: DesktopBridge = { isElectron: true, backendMode: 'local',
    getPathForFile() { pathReads++; return 'C:\\Users\\person\\report.txt'; } };
  assert.equal(filePath(file, local), 'C:\\Users\\person\\report.txt');
  assert.equal(filePath(file, { ...local, backendMode: 'remote' }), '');
  assert.equal(filePath(file, undefined), '');
  assert.equal(pathReads, 1);
});

test('a remote Electron shell cannot claim a local backend browser surface', () => {
  const surface = { show: async () => {}, hide: async () => {}, setInputEnabled: async () => {} };
  const local: DesktopBridge = { isElectron: true, getPathForFile: () => '', executionSurface: surface };
  assert.equal(getDesktopExecutionSurface(local), surface);
  assert.equal(getDesktopExecutionSurface({ ...local, backendMode: 'remote' }), undefined);
  assert.equal(getDesktopExecutionSurface({ ...local, executionSurface: undefined }), undefined);
  assert.equal(getDesktopExecutionSurface(undefined), undefined);
});

test('an explicit remote backend disables local paths and browser IPC even in a local shell', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const surface = { show: async () => {}, hide: async () => {}, setInputEnabled: async () => {} };
  const local: DesktopBridge = { isElectron: true, backendMode: 'local',
    getPathForFile: () => 'C:\\report.txt', executionSurface: surface };
  const target = { location: { origin: 'http://localhost:5173' },
    __FOURTORM_CONNECTION__: { origin: 'https://work.example' } };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: target });
  try {
    assert.equal(filePath(new File(['report'], 'report.txt'), local), '');
    assert.equal(getDesktopExecutionSurface(local), undefined);
    target.__FOURTORM_CONNECTION__.origin = 'http://localhost:5173';
    assert.equal(filePath(new File(['report'], 'report.txt'), local), 'C:\\report.txt');
    assert.equal(getDesktopExecutionSurface(local), surface);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'window', previous);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});
