# downcity-local-proxy-skill

Codex skill for creating a standalone Downcity local proxy backed by CLIProxyAPI.

The skill lives in `downcity-local-proxy/`. It scaffolds a local project that starts:

- CLIProxyAPI on `127.0.0.1:8317`
- Downcity local Federation on `127.0.0.1:3000`

## Install

Clone this repository and copy or symlink the skill folder into your Codex skills directory:

```bash
mkdir -p ~/.codex/skills
ln -s "$(pwd)/downcity-local-proxy" ~/.codex/skills/downcity-local-proxy
```

## Use

Ask Codex:

```text
Use downcity-local-proxy to create ./downcity/local-proxy with Codex and Claude Code enabled.
```

Or run the scaffold script directly:

```bash
node downcity-local-proxy/scripts/create-local-proxy.mjs --target ./downcity/local-proxy
cd ./downcity/local-proxy
pnpm install
pnpm start --codex --claude-code
```
