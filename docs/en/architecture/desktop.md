# Desktop · Electron

4torm runs in a browser or through Electron. Both use the same interface, workspaces, and runtime data; desktop additionally provides native local paths and execution windows.

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

## Desktop Capabilities

Electron can obtain the real local path of a dropped file, allowing an agent to access it under the active workspace and execution permission. A normal browser cannot obtain arbitrary local paths and instead uses the upload or input mechanism of the current workspace.

Browser tools may open a native in-app browser window. Humans can open it from the taskboard, transfer control between agent and human, and close it when needed. This is currently available in Monsoon and ordinary Cyclone seat conversations.

## Service Lifecycle

The desktop shell starts and connects to the 4torm server and ends its managed server process when the app closes. Let important tasks and background executions finish first.

A directly launched server drains work on a normal exit signal. Forced termination, directly closing the desktop app, or power loss may discard runtime state not yet persisted. Back up `data/` and external workspaces regularly.

## Security Boundary

The desktop page does not receive unrestricted Node.js access. Native paths and execution windows are exposed through a limited bridge. Agent file access remains governed by its execution permission and current workspace.

See [Data Layout](./data-layout) and [Security and Isolation](./security).
