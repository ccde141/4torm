# 4torm

> 4torm — AI Agent Chat & Visual Workflow Orchestration, reshaping development like a storm [Vibe Coding]

<p align="center">
  <img src="./public/4TORM.png" alt="4torm" width="120" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License" />
  <img src="https://img.shields.io/badge/TypeScript-007ACC?logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react" alt="React 19" />
  <img src="https://img.shields.io/badge/Vite-646CFF?logo=vite" alt="Vite" />
  <img src="https://img.shields.io/badge/PRs-welcome-brightgreen" alt="PRs Welcome" />
</p>

<p align="center">
  AI Agent Chat · Visual Workflow Builder · Tool/Skill System · Pure Frontend
</p>

<p align="center">
  <a href="https://github.com/ccde141/4torm/issues">Report Bug</a>
  ·
  <a href="https://github.com/ccde141/4torm">Repository</a>
  ·
  <a href="./README.md">中文版</a>
</p>

---

## Features

### 🤖 AI Agent Chat
Multi-model support (OpenAI / Anthropic / Ollama) with streaming output and real-time Think reasoning visibility. **Single Agent, multiple sessions** — each session maintains independent context, agents are fully decoupled from chat history, allowing the same Agent to run across multiple sessions in parallel.

### ⚙️ Prompt-Driven Sandbox Workflow
A drag-and-drop node orchestration engine where **every connection (Arrow) is a precise Prompt pipeline**, not just a data flow:

- `extractField` — Extract a specific field from upstream output to pass downstream, instead of forwarding the entire payload
- `contextMode` — Automatically summarize upstream output as contextual background for the downstream node
- `injectRole` — Override the downstream Agent's role prompt with upstream output, enabling dynamic role chaining

Here, you don't write logic in code — you **define semantic data transformation between nodes using prompts**.

### ⚠️ Sandbox Workflow (Testing Stage)
The sandbox workflow is currently in **testing stage**. Some features may be unstable or incomplete. Issues and feedback are welcome.

### 🧩 Agent Node: Dual-Layer Decoupling
Each Agent node in a workflow has two independent layers:

- **Outer layer — Agent entity reference** (`agentId`): Links to the Agent's model config, tools, and skills. Agents are managed independently in the Dashboard.
- **Inner layer — Runtime role override** (`agentRole`): Editable role prompt with template variables (`{{goal}}`, `{{input}}`, `{{context}}`), allowing the same Agent to behave differently across workflow nodes.

### 🧠 Long-Term Memory
A `MEMORY.md`-based memory mechanism enables Agents to perceive cross-session context for persistent recall. Supports `/compact` command for conversation history compression.

### 🔧 Tool / Skill System
Agents can autonomously read documentation and create tools and skills on demand. Built-in executors include file I/O, web search, and code execution — the framework is self-extending at runtime.

### 🎨 Customizable Skin
Freely customize primary color + ambient glow, switch between light/dark themes with one click.

### 📦 Pure Frontend
No backend required. All data is stored locally as JSON files. Configure an API Key and use everything in the browser.

## Quick Start

### Prerequisites

- Node.js 18+
- npm 9+

### Install & Run

```bash
git clone https://github.com/ccde141/4torm.git
cd 4torm
npm install
npm run dev
```

Open `http://localhost:5173` in your browser, go to Settings in the sidebar to add your API Key, and start using it.

### Production Build

```bash
npm run build
npm run preview
```

### Dashboard — Home Page

The application's home page, providing a centralized view of all registered Agents and their runtime status. The left sidebar lists Agents for quick switching and status identification. The main area displays session overviews in card layout. Top navigation provides Agent creation and configuration access, supporting custom role prompts, model parameters, and more.

<p align="center">
  <img src="./public/screenshots/Dashboard.png" alt="Dashboard" width="100%" />
  <em>Dashboard — Agent management home with status overview and creation tools</em>
</p>

---

### Multi-Session Chat — Session

Real-time chat interface with multi-session management. Each message displays the model name and token usage. The screenshots cover two core scenarios: **Think reasoning process** (visualization of the model's thinking chain) and **Tool calling** (Action invocation details, parameters, and results). The left panel supports history session management.

<p align="center">
  <img src="./public/screenshots/session.png" alt="Session" width="100%" />
  <em>Session — Chat interface showing Think reasoning and tool calling</em>
</p>

<p align="center">
  <img src="./public/screenshots/session2.png" alt="Session Detail" width="100%" />
  <em>Session — Chat interface showing Think reasoning and tool calling (2)</em>
</p>

---

### Sandbox Workflow — Sandbox

A visual workflow orchestration engine within the Sandbox module, demonstrated through two screenshots:
- **Workflow Canvas**: Build automated workflows by dragging and connecting nodes — supports Entry, Agent nodes, Condition branches, Loops, Fork/Merge, Human Gates, and more
- **Parameter Configuration**: Select a node to configure prompts, model parameters, timeout, retry policies, etc.

<p align="center">
  <img src="./public/screenshots/sandbox1.png" alt="Sandbox Workflow" width="100%" />
  <em>Sandbox — Example workflow canvas with node orchestration</em>
</p>

<p align="center">
  <img src="./public/screenshots/sandbox2.png" alt="Sandbox Detail" width="100%" />
  <em>Sandbox — Example workflow node parameter configuration</em>
</p>

---

### Skill Management — Skills

Lists all registered skills with their names, descriptions, and enable/disable status. Skills provide high-level encapsulation of tool calls — Agents can trigger complete multi-step operations by skill name.

<p align="center">
  <img src="./public/screenshots/Skills.png" alt="Skills" width="100%" />
  <em>Skills — Skill list page</em>
</p>

---

### Tool Management — Tools

Displays built-in system tools along with their corresponding prompt configurations. Each tool includes parameter definitions and invocation instructions, supporting centralized management of multiple tools. The screenshot shows two configured tool examples.

<p align="center">
  <img src="./public/screenshots/Tools.png" alt="Tools" width="100%" />
  <em>Tools — Built-in tool list with prompt configuration</em>
</p>

---

### LLM Provider Configuration — LLM Provider

Unified management for multiple model providers. Supports custom API connections and comes with pre-configured provider templates (OpenAI, Anthropic, Ollama, etc.) for quick integration with different LLM services.

> Presets are all OpenAI-compatible services. For non-OpenAI APIs (e.g., Anthropic Claude), deploy [one-api](https://github.com/songquanpeng/one-api) or [LiteLLM](https://github.com/BerriAI/litellm) as a translation proxy and use its address.

<p align="center">
  <img src="./public/screenshots/LLM.png" alt="LLM Config" width="100%" />
  <em>LLM Provider — Multi-provider configuration with preset templates</em>
</p>

## Usage Guide

1. **Configure API Key** — Go to Settings in the sidebar to add your API Key (OpenAI / Anthropic / Ollama supported)
2. **Create an Agent** — Define the Agent's name, role description, and model parameters — this is the core of all sessions and workflows
3. **Start a Chat** — Select an Agent, customize its role prompt, and begin the conversation
4. **Build a Workflow** — Switch to Sandbox mode, drag and drop nodes to create automated workflows with conditional branches, loops, human approval gates, and more
5. **Long-Term Memory** — Create a `MEMORY.md` in the Agent's workspace; the Agent will read and follow it for cross-session recall
6. **Command System** — `/compact` (compress conversation history), `/start` (re-guide the Agent)

## Tech Stack

| Category | Technology |
|----------|-----------|
| Frontend Framework | React 19 + TypeScript |
| Build Tool | Vite |
| AI SDK | Anthropic Claude API / OpenAI API |
| State Management | Zustand |
| Sandbox Engine | Custom visual node orchestration system |
| Styling | Native CSS + CSS Custom Properties + Dynamic Themes |

## Project Structure

```
4torm/
├── src/
│   ├── components/           # UI components
│   │   ├── chat/             # Chat system (message flow, Think display, session list)
│   │   ├── sandbox/          # Sandbox workflow (node drag-drop, canvas, config panel)
│   │   ├── layout/           # Layout framework (sidebar, header, skin panel)
│   │   └── agents/           # Agent management (config, dashboard)
│   ├── engine/               # Core engine (prompt assembly, Agent process, sandbox executor)
│   ├── store/                # State management & data persistence
│   ├── styles/               # CSS styles & theme variables
│   └── App.tsx               # Root application component
├── docs/                     # Documentation
│   ├── sandbox-nodes-reference.md
│   ├── tools-reference.md
│   └── skills-reference.md
├── data/                     # Runtime data (sessions, Agent configs, provider configs)
└── public/                   # Static assets
```

## Documentation

- [Sandbox Nodes Reference](./docs/sandbox-nodes-reference.md) — Configuration and behavior of all available workflow nodes
- [Tool Registration Guide](./docs/tools-reference.md) — How to register and use custom tools
- [Skill Development Guide](./docs/skills-reference.md) — How to create and install Agent skills

## Architecture Highlights

### Sandbox: Prompt-Driven Node Orchestration

Every **Arrow (edge)** in the sandbox is not just a data flow — it is a **prompt logic system**. Each edge carries an `ArrowConfig` that controls data transformation across three semantic dimensions:

| Config | Purpose |
|--------|---------|
| `extractField` | Extract a specific field from upstream output to pass downstream |
| `contextMode` | Auto-summarize upstream output (truncate to 500 chars) as downstream context |
| `injectRole` | Override the downstream Agent's role prompt with upstream output for dynamic role chains |

In 4torm, you **don't write logic in code — you define semantic data transformation between nodes using prompts**. Every edge is a precise Prompt pipeline.

### Agent Node: Dual-Layer Decoupling

Workflow Agent nodes have **two independent layers**:

- **Outer layer — Agent entity reference**: Links to a real Agent via `agentId` (carrying its model config, tools, and skills). The Agent itself is managed independently in the Dashboard, decoupled from the workflow.
- **Inner layer — Runtime role override**: The `agentRole` field can be edited independently to override the Agent's default role prompt. Supports template variables (`{{goal}}`, `{{input}}`, `{{context}}`), allowing the same Agent to exhibit different behaviors in different workflow nodes.

### Fully Decoupled Three-Layer Architecture

```
Dashboard (Agent Mgmt)           Sandbox (Workflow)           Chat (Sessions)
     │                              │                          │
     │  Agent Entity                 │   Envelope              │  Message List
     │  (Model/Tools/Skills)         │   (Pure Data)           │  (Chat History)
     │  Read-only ref ◄──────        │                          │
     │                              │  Zero chat dependency    │
     │                              │  Independent file store  │
     │                              │  Independent state mgmt  │
```

- **Sandbox & Chat fully decoupled** — The sandbox uses an independent `Envelope` data structure for data transfer. All LLM calls are stateless, with zero dependency on chat history
- **Sandbox & Agent loosely coupled** — Workflow nodes reference Agent config read-only via `agentId`. Full Agent configuration is managed in the Dashboard
- **Files as database** — All data stored as JSON files for easy versioning and debugging
- **Self-extending Agent** — Agents can read documentation and autonomously create Tools/Skills at runtime

## How to Contribute

Issues and Pull Requests are welcome!

- Search existing issues before filing a new one
- Local development: `npm install` → `npm run dev`
- Code style: TypeScript strict mode

## License

[MIT](./LICENSE) © Ccde141

## Contact

- GitHub Issues: [github.com/ccde141/4torm/issues](https://github.com/ccde141/4torm/issues)
- Repository: [github.com/ccde141/4torm](https://github.com/ccde141/4torm)
