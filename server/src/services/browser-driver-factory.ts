import type { BrowserDriver } from './browser-driver.js';
import { DesktopBrowserDriver } from './desktop-browser-driver.js';
import { DesktopBrowserTransportClient } from './desktop-browser-transport.js';
import { PlaywrightBrowserDriver } from './playwright-browser-driver.js';

export function createBrowserDriverFromEnvironment(environment: NodeJS.ProcessEnv = process.env): BrowserDriver {
  const endpoint = environment.FOURTORM_DESKTOP_BRIDGE;
  const token = environment.FOURTORM_DESKTOP_BROWSER_TOKEN;
  if (!endpoint && !token) return new PlaywrightBrowserDriver();
  if (!endpoint || !token) throw new Error('desktop browser bridge configuration is incomplete');
  return new DesktopBrowserDriver(new DesktopBrowserTransportClient({ endpoint, token }));
}
