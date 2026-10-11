# Architecture Overview

The 4torm interface receives human actions, the server runs agents, tools, and collaborative work, and model providers generate responses. Configuration, conversations, and task records are stored locally. The browser and Electron desktop app provide the same feature areas; desktop also provides native file paths and execution windows.

## How Work Flows

A person starts work in Monsoon, Convection, Cyclone, Tradewind, or Tide. The server calls the model with the current workspace context, agent configuration, and available capabilities. When the model requests a tool, the server runs it and returns the result. Responses and execution changes can appear live, while the owning feature saves the resulting content.

Live transport presents work as it happens; it is not the history store. Reopening a page loads saved content; features that support activity synchronization also check server-managed work still running. Transient fragments shown before a disconnect are not replayed if they were never saved.

## Features and the Central Router

An agent created in the Console can work in several features, but each feature owns its conversations, workspaces, and execution rules. A full conversation in one place does not automatically become context in another.

The human interface, agent tools, and scheduled triggers have different entry points. Operations that coordinate feature work pass through the central router for admission and dispatch, then the relevant feature decides how to run them. Features collaborate through public interfaces rather than each other's internals. The center does not keep a second copy of business state.

## State, Records, and Recovery

Current state and history come from each feature's actual execution and saved records. A shared observation mechanism makes the needed facts available to the interface and agents. If part of the information cannot be read, it is reported as incomplete rather than appearing idle or successful.

Closing a browser tab does not stop the server. Server-managed work may continue, while an interactive response tied to the current stream may stop. Closing the desktop app ends the server it manages. The server winds down work on a normal exit; a forced exit or power loss can discard output that was not yet saved. After restart, read the current state and records to determine what happened.

## Where to Read More

See [Data Layout](./data-layout) for storage, [Security and Isolation](./security) for file access, and [Desktop · Electron](./desktop) for desktop behavior. In the source, start with `src/` for the interface, `server/src/modules/` for feature boundaries, and `server/src/engine/collaboration/` for the central router. Module public entries and their tests define the specific contracts.
