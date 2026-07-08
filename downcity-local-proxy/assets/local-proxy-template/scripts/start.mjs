#!/usr/bin/env node

/**
 * Start CLIProxyAPI and the local Downcity Federation together.
 */

import fs from "node:fs/promises";
import process from "node:process";
import { spawn } from "node:child_process";
import {
  runCliProxyLogin,
  startCliProxy,
  waitForTcp,
} from "./cliproxy.mjs";

const options = parseArgs(process.argv.slice(2));
const enabled_groups = resolveEnabledGroups(options);
const proxy_host = options.proxyHost ?? process.env.CLIPROXY_HOST ?? "127.0.0.1";
const proxy_port = Number(options.proxyPort ?? process.env.CLIPROXY_PORT ?? 8317);
const fed_port = Number(options.fedPort ?? process.env.PORT ?? 3000);
const api_key = process.env.CLIPROXY_API_KEY ?? "downcity-local-proxy";

await ensureEnvFile({
  proxy_host,
  proxy_port,
  fed_port,
  api_key,
  enabled_groups,
});

if (options.login) {
  await runCliProxyLogin({
    codex: enabled_groups.includes("codex"),
    claudeCode: enabled_groups.includes("claude-code"),
    host: proxy_host,
    port: proxy_port,
    apiKey: api_key,
  });
}

const cliproxy = await startCliProxy({
  host: proxy_host,
  port: proxy_port,
  apiKey: api_key,
});
await waitForTcp(proxy_host, proxy_port);
console.log(`[downcity-local-proxy] CLIProxyAPI listening on http://${proxy_host}:${proxy_port}/v1`);

const fed = spawn("pnpm", ["exec", "tsx", "src/index.ts"], {
  cwd: process.cwd(),
  stdio: "inherit",
  env: {
    ...process.env,
    PORT: String(fed_port),
    PUBLIC_URL: process.env.PUBLIC_URL ?? `http://127.0.0.1:${fed_port}`,
    CLIPROXY_HOST: proxy_host,
    CLIPROXY_PORT: String(proxy_port),
    CLIPROXY_API_BASE_URL: process.env.CLIPROXY_API_BASE_URL ?? `http://${proxy_host}:${proxy_port}/v1`,
    CLIPROXY_API_KEY: api_key,
    DOWNCITY_LOCAL_MODELS: enabled_groups.join(","),
  },
});

let shutting_down = false;
const shutdown = () => {
  if (shutting_down) return;
  shutting_down = true;
  fed.kill("SIGTERM");
  cliproxy.kill("SIGTERM");
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

fed.once("exit", (code) => {
  cliproxy.kill("SIGTERM");
  process.exitCode = code ?? 0;
});

function parseArgs(argv) {
  const out = {
    codex: false,
    claudeCode: false,
    login: false,
    proxyHost: undefined,
    proxyPort: undefined,
    fedPort: undefined,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--codex") {
      out.codex = true;
      continue;
    }
    if (item === "--claude-code") {
      out.claudeCode = true;
      continue;
    }
    if (item === "--login") {
      out.login = true;
      continue;
    }
    if (item === "--proxy-host") {
      out.proxyHost = argv[index + 1];
      index += 1;
      continue;
    }
    if (item === "--proxy-port") {
      out.proxyPort = argv[index + 1];
      index += 1;
      continue;
    }
    if (item === "--fed-port") {
      out.fedPort = argv[index + 1];
      index += 1;
      continue;
    }
    if (item === "--help" || item === "-h") {
      printHelp();
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${item}`);
  }
  return out;
}

function printHelp() {
  console.log("Usage: pnpm start [--codex] [--claude-code] [--login] [--proxy-port 8317] [--fed-port 3000]");
}

function resolveEnabledGroups(input) {
  const groups = [];
  if (input.codex) groups.push("codex");
  if (input.claudeCode) groups.push("claude-code");
  if (groups.length > 0) return groups;
  return ["codex", "claude-code"];
}

async function ensureEnvFile(input) {
  const exists = await fs.stat(".env").catch(() => null);
  if (exists?.isFile()) return;
  const text = [
    "PORT=" + input.fed_port,
    `PUBLIC_URL=http://127.0.0.1:${input.fed_port}`,
    "DATABASE_PATH=./data/local.db",
    "DOWNCITY_LOCAL_CITY_ID=vibecape",
    "DOWNCITY_LOCAL_CITY_NAME=Vibecape",
    "DOWNCITY_FEDERATION_ADMIN_SECRET_KEY=local-proxy-admin-secret",
    `CLIPROXY_HOST=${input.proxy_host}`,
    `CLIPROXY_PORT=${input.proxy_port}`,
    `CLIPROXY_API_BASE_URL=http://${input.proxy_host}:${input.proxy_port}/v1`,
    `CLIPROXY_API_KEY=${input.api_key}`,
    `DOWNCITY_LOCAL_MODELS=${input.enabled_groups.join(",")}`,
    "DOWNCITY_CODEX_MODELS=codex-gpt-5-5=gpt-5.5,codex-gpt-5-codex=gpt-5-codex",
    "DOWNCITY_CLAUDE_CODE_MODELS=claude-code-sonnet=claude-sonnet-4.6",
    "",
  ].join("\n");
  await fs.writeFile(".env", text, "utf8");
}
