---
name: downcity-local-proxy
description: Create a standalone Downcity local proxy project that runs CLIProxyAPI as a sidecar and exposes Codex or Claude Code model access through a local Downcity Federation service. Use when the user wants to create, scaffold, install, configure, or start ./downcity/local-proxy, a local-node-style Fed SDK project, or a CLIProxyAPI-backed Downcity agent model proxy.
---

# Downcity Local Proxy

## Overview

Create a local project that combines:

- `CLIProxyAPI` for Codex / Claude Code OAuth and OpenAI-compatible local model access.
- Downcity Fed SDK for a local Federation server exposing `/v1/ai/models` and `/v1/ai/chat/completions`.

Do not modify `downfed` server profiles, user global City state, or existing Federation deployments. This skill creates a standalone project, normally at `./downcity/local-proxy`.

## Quick Start

Run the bundled scaffold script from this skill:

```bash
node <skill-dir>/scripts/create-local-proxy.mjs --target ./downcity/local-proxy
```

Then start from the generated project:

```bash
cd ./downcity/local-proxy
pnpm install
pnpm start --codex
pnpm start --claude-code
pnpm start --codex --claude-code
```

Use `--login` when the user needs to run or refresh CLIProxyAPI OAuth:

```bash
pnpm start --codex --login
pnpm start --claude-code --login
```

## Workflow

1. Resolve the target directory.
   - Default to `./downcity/local-proxy` relative to the current workspace.
   - Use the user's explicit path when provided.

2. Run `scripts/create-local-proxy.mjs`.
   - Use `--force` only when the user explicitly asks to overwrite the target.
   - The script copies `assets/local-proxy-template` and keeps existing files safe by default.

3. Tell the user the generated project commands.
   - `pnpm install`
   - `pnpm start --codex`
   - `pnpm start --claude-code`
   - `pnpm typecheck`

4. If asked to start the service immediately, run the generated commands.
   - The start script downloads CLIProxyAPI from GitHub releases when needed.
   - It writes local runtime files under `.downcity/`.
   - It starts CLIProxyAPI on `127.0.0.1:8317`.
   - It starts the local Downcity Federation on `127.0.0.1:3000`.

## Generated Project Contract

The generated project is intentionally local and standalone:

- It does not register itself into any existing fed server.
- It does not write global Downcity CLI state.
- It uses `CLIProxyAPI` as the only upstream model bridge.
- It uses local SQLite under `./data/local.db`.
- It auto-injects the local admin secret for local HTTP calls.

Default endpoints:

```text
CLIProxyAPI:              http://127.0.0.1:8317/v1
Downcity local proxy:     http://127.0.0.1:3000
Models endpoint:          http://127.0.0.1:3000/v1/ai/models
Chat completions endpoint http://127.0.0.1:3000/v1/ai/chat/completions
```

Model defaults can be changed in `.env`:

```env
DOWNCITY_LOCAL_MODELS=codex,claude-code
DOWNCITY_CODEX_MODELS=codex-gpt-5-5=gpt-5.5,codex-gpt-5-codex=gpt-5-codex
DOWNCITY_CLAUDE_CODE_MODELS=claude-code-sonnet=claude-sonnet-4.6
```

Each model spec is either `local_id=upstream_id` or `model_id`.

## Resources

- `scripts/create-local-proxy.mjs` scaffolds the project.
- `assets/local-proxy-template/` is the copied project template.
