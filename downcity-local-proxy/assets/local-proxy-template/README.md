# Downcity Local Proxy

Standalone local Federation backed by CLIProxyAPI.

```bash
pnpm install
pnpm start --codex
pnpm start --claude-code
pnpm start --codex --claude-code
```

Use `--login` to run CLIProxyAPI OAuth login before starting:

```bash
pnpm start --codex --login
pnpm start --claude-code --login
```

Endpoints:

- CLIProxyAPI: `http://127.0.0.1:8317/v1`
- Downcity Federation: `http://127.0.0.1:3000`
- Models: `http://127.0.0.1:3000/v1/ai/models`
- Chat completions: `http://127.0.0.1:3000/v1/ai/chat/completions`
