# Desktop · Electron

4torm runs in a browser or through Electron. Both use the same interface and workspaces, with data stored on the connected backend. Local desktop mode also provides native local paths and execution windows.

## Start the Desktop App

Development:

```bash
npm run electron:dev
```

Production:

```bash
npm run build
npm run electron:prod
```

For installation and startup on a graphical Linux desktop, see [Linux Desktop](https://github.com/ccde141/4torm/blob/master/LINUX.md) (Chinese). For hosting the backend on Linux or Docker and connecting from another device, see [Independent Backend and Remote Clients](https://github.com/ccde141/4torm/blob/master/REMOTE.md) (Chinese).

## Desktop Capabilities

Local desktop mode can obtain the real local path of a dropped file, allowing an agent to access it under the active workspace and execution permission. Browser and remote desktop modes upload file content rather than treating a client disk path as a backend workspace path.

In local desktop mode, browser tools may open a native in-app browser window. Humans can open it from the taskboard, transfer control between agent and human, and close it when needed. This is currently available in Monsoon and ordinary Cyclone seat conversations. Remote clients do not provide local execution windows.

## Service Lifecycle

In local desktop mode, the shell starts and connects to the 4torm server and ends its managed server process when the app closes. Let important tasks and background executions finish first.

With a remote backend address configured, the desktop app connects to that backend without starting a local server. Closing a remote client or browser page does not close an independently deployed backend.

A directly launched server drains work on a normal exit signal. Forced termination, directly closing the desktop app, or power loss may discard runtime state not yet persisted. Back up `data/` and external workspaces regularly.

## Security Boundary

The desktop page does not receive unrestricted Node.js access. Native paths and execution windows are exposed through a limited bridge. Agent file access remains governed by its execution permission and current workspace.

See [Data Layout](./data-layout) and [Security and Isolation](./security).
