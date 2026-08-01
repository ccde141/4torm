import assert from 'node:assert/strict';
import test from 'node:test';
import { createBrowserDriverFromEnvironment } from './browser-driver-factory.js';
import { DesktopBrowserDriver } from './desktop-browser-driver.js';
import { PlaywrightBrowserDriver } from './playwright-browser-driver.js';

test('browser driver factory uses Playwright when no desktop bridge is configured', () => {
  const driver = createBrowserDriverFromEnvironment({});

  assert.ok(driver instanceof PlaywrightBrowserDriver);
});

test('browser driver factory uses the desktop transport only with complete bridge configuration', () => {
  const driver = createBrowserDriverFromEnvironment({ FOURTORM_DESKTOP_BRIDGE: '\\\\.\\pipe\\4torm-test', FOURTORM_DESKTOP_BROWSER_TOKEN: 'secret' });

  assert.ok(driver instanceof DesktopBrowserDriver);
});

test('browser driver factory rejects partial desktop bridge configuration', () => {
  assert.throws(
    () => createBrowserDriverFromEnvironment({ FOURTORM_DESKTOP_BRIDGE: '\\\\.\\pipe\\4torm-test' }),
    /desktop browser bridge configuration is incomplete/,
  );
});
