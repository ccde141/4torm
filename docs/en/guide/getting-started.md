# Quick Start

## Requirements

- Node.js 20+
- npm 9+

## Installation

```bash
cd 4torm
npm install
cd server
npm install
cd ..
```

Frontend dependencies are installed at the repository root; server dependencies are installed under `server/`. Both are required.

## Running 4torm

4torm supports browser and desktop (Electron) shells, each in development and production modes:

```bash
# Browser development: Fastify (:3001) + Vite (:5173), with HMR
npm run dev                                # → http://localhost:5173

# Desktop development: adds an Electron window to the services above
npm run electron:dev

# Browser production: Fastify serves the completed build
npm run build && npm run start:prod        # → http://localhost:3001

# Desktop production: Electron starts the self-hosted service
npm run build && npm run electron:prod
```

- In **development**, `concurrently` starts Fastify and Vite. Frontend requests reach `/api/*` through `localhost`, with HMR enabled.
- In **production**, Fastify serves the built frontend through `@fastify/static`, so the app runs as a single process. See [Desktop · Electron](../architecture/desktop) for native path support.

## Initial Setup

1. **Add a model provider** — Open **Provider Management** in the Console, enter an API URL and key, and enable the models you need. 4torm supports OpenAI Compatible and Anthropic Messages APIs. See [Model Providers](./providers).
2. **Create an agent** — Go to Console → New Agent, select a model, enter a role prompt, and review the tools and skills enabled by default. See [Console and Agent Management](./agents).
3. **Start a conversation** — Select **Monsoon** in the sidebar, choose an agent, and send a message.

## Next Steps

- Learn about agents, tools, skills, and other foundations in [Core Concepts](./concepts).
- Choose a workspace: [Monsoon](../modes/chat), [Convection](../modes/convection), [Cyclone](../modes/cyclone), [Tradewind](../modes/tradewind), or [Tide](../modes/tide).
- Extend agents with [Tools](../extend/tools), [Skills](../extend/skills), and [MCP](../extend/mcp).
