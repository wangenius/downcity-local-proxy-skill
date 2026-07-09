# downcity-local-proxy-skill

Codex skill for creating a standalone Downcity local proxy backed by CLIProxyAPI.

The skill lives in `skills/downcity-local-proxy/`. It scaffolds a local project that starts:

- CLIProxyAPI on `127.0.0.1:8317`
- Downcity local Federation on `127.0.0.1:3000`

## Install

Install with the Vercel Labs `skills` CLI:

```bash
npx skills add https://github.com/wangenius/downcity-local-proxy-skill \
  --skill downcity-local-proxy \
  --agent codex \
  --global \
  --yes
```

For local development before the GitHub repository is published, install from a local checkout:

```bash
npx skills add . \
  --skill downcity-local-proxy \
  --agent codex \
  --global \
  --yes \
  --copy
```

## Use

Ask Codex:

```text
Use downcity-local-proxy to create ./downcity/local-proxy with Codex and Claude Code enabled.
```

Or run the scaffold script directly:

```bash
node skills/downcity-local-proxy/scripts/create-local-proxy.mjs --target ./downcity/local-proxy
cd ./downcity/local-proxy
pnpm install
pnpm start --codex --claude-code
```
