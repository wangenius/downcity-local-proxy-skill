#!/usr/bin/env node

/**
 * CLIProxyAPI sidecar helper.
 *
 * 关键点（中文）：
 * - 下载官方 GitHub release 到本项目 `.downcity/cliproxy`。
 * - 生成最小本机配置，默认只监听 127.0.0.1。
 * - 暴露函数给 `scripts/start.mjs` 编排登录和启动流程。
 */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";

const REPO = "router-for-me/CLIProxyAPI";
const DEFAULT_VERSION = "latest";

export function resolveRuntime(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const runtime_dir = path.join(cwd, ".downcity", "cliproxy");
  const bin_dir = path.join(runtime_dir, "bin");
  const config_path = path.join(runtime_dir, "config.yaml");
  const auth_dir = path.join(runtime_dir, "auth");
  const download_dir = path.join(runtime_dir, "downloads");
  const binary_path = path.join(bin_dir, process.platform === "win32" ? "cli-proxy-api.exe" : "cli-proxy-api");
  return {
    cwd,
    runtime_dir,
    bin_dir,
    config_path,
    auth_dir,
    download_dir,
    binary_path,
  };
}

export async function ensureCliProxy(options = {}) {
  const runtime = resolveRuntime(options);
  const existing = await fs.stat(runtime.binary_path).catch(() => null);
  if (existing?.isFile()) return runtime.binary_path;

  await fs.mkdir(runtime.bin_dir, { recursive: true });
  await fs.mkdir(runtime.download_dir, { recursive: true });

  const release = await resolveRelease(options.version ?? process.env.CLIPROXY_VERSION ?? DEFAULT_VERSION);
  const asset = selectAsset(release.assets);
  const archive_path = path.join(runtime.download_dir, asset.name);
  await downloadFile(asset.browser_download_url, archive_path);
  await extractArchive(archive_path, runtime.bin_dir);
  await normalizeBinary(runtime.bin_dir, runtime.binary_path);
  return runtime.binary_path;
}

export async function writeCliProxyConfig(options = {}) {
  const runtime = resolveRuntime(options);
  const host = options.host ?? process.env.CLIPROXY_HOST ?? "127.0.0.1";
  const port = Number(options.port ?? process.env.CLIPROXY_PORT ?? 8317);
  const api_key = options.apiKey ?? process.env.CLIPROXY_API_KEY ?? "downcity-local-proxy";

  await fs.mkdir(runtime.runtime_dir, { recursive: true });
  await fs.mkdir(runtime.auth_dir, { recursive: true });

  const yaml = [
    `host: "${host}"`,
    `port: ${port}`,
    "tls:",
    "  enable: false",
    "  cert: \"\"",
    "  key: \"\"",
    "remote-management:",
    "  allow-remote: false",
    "  secret-key: \"\"",
    "  disable-control-panel: true",
    `auth-dir: "${escapeYaml(runtime.auth_dir)}"`,
    "api-keys:",
    `  - "${escapeYaml(api_key)}"`,
    "debug: false",
    "logging-to-file: true",
    "usage-statistics-enabled: false",
    "request-retry: 2",
    "force-model-prefix: false",
    "codex:",
    "  identity-confuse: false",
    "",
  ].join("\n");

  await fs.writeFile(runtime.config_path, yaml, "utf8");
  return runtime.config_path;
}

export async function runCliProxyLogin(options = {}) {
  const binary_path = await ensureCliProxy(options);
  await writeCliProxyConfig(options);

  const login_flags = [];
  if (options.codex) login_flags.push("-codex-login");
  if (options.claudeCode) login_flags.push("-claude-login");
  if (login_flags.length === 0) return;

  for (const flag of login_flags) {
    await runProcess(binary_path, [flag, "-config", resolveRuntime(options).config_path], {
      cwd: options.cwd ?? process.cwd(),
      stdio: "inherit",
    });
  }
}

export async function startCliProxy(options = {}) {
  const binary_path = await ensureCliProxy(options);
  const config_path = await writeCliProxyConfig(options);
  const child = spawn(binary_path, ["-config", config_path, "-local-model"], {
    cwd: options.cwd ?? process.cwd(),
    stdio: options.stdio ?? "inherit",
    env: process.env,
  });
  child.once("exit", (code, signal) => {
    if (code !== null && code !== 0) {
      console.error(`[cliproxy] exited with code ${code}`);
    }
    if (signal) {
      console.error(`[cliproxy] exited by signal ${signal}`);
    }
  });
  return child;
}

export async function waitForTcp(host, port, timeoutMs = 20_000) {
  const started_at = Date.now();
  while (Date.now() - started_at < timeoutMs) {
    if (await canConnect(host, port)) return;
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${host}:${port}`);
}

async function resolveRelease(version) {
  const api_url = version === "latest"
    ? `https://api.github.com/repos/${REPO}/releases/latest`
    : `https://api.github.com/repos/${REPO}/releases/tags/${version}`;
  const response = await fetch(api_url, {
    headers: { "User-Agent": "downcity-local-proxy" },
  });
  if (!response.ok) {
    throw new Error(`Failed to resolve CLIProxyAPI release: ${response.status} ${await response.text()}`);
  }
  return await response.json();
}

function selectAsset(assets) {
  const platform = process.platform;
  const arch = process.arch;
  const platform_name = platform === "darwin"
    ? "darwin"
    : platform === "linux"
      ? "linux"
      : platform === "win32"
        ? "windows"
        : "";
  const arch_name = arch === "arm64" ? "aarch64" : arch === "x64" ? "amd64" : "";
  if (!platform_name || !arch_name) {
    throw new Error(`Unsupported platform: ${platform}/${arch}`);
  }
  const suffix = platform === "win32" ? ".zip" : ".tar.gz";
  const matched = assets.find((asset) =>
    asset.name.includes(platform_name) &&
    asset.name.includes(arch_name) &&
    asset.name.endsWith(suffix) &&
    !asset.name.includes("no-plugin")
  );
  if (!matched) {
    throw new Error(`No CLIProxyAPI asset for ${platform}/${arch}`);
  }
  return matched;
}

async function downloadFile(url, target_path) {
  const response = await fetch(url, {
    headers: { "User-Agent": "downcity-local-proxy" },
  });
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download ${url}: ${response.status}`);
  }
  const temp_path = `${target_path}.${crypto.randomUUID()}.tmp`;
  const file = await fs.open(temp_path, "w");
  try {
    for await (const chunk of response.body) {
      await file.write(chunk);
    }
  } finally {
    await file.close();
  }
  await fs.rename(temp_path, target_path);
}

async function extractArchive(archive_path, target_dir) {
  if (archive_path.endsWith(".tar.gz")) {
    await runProcess("tar", ["-xzf", archive_path, "-C", target_dir], { stdio: "inherit" });
    return;
  }
  if (archive_path.endsWith(".zip")) {
    await runProcess("unzip", ["-o", archive_path, "-d", target_dir], { stdio: "inherit" });
    return;
  }
  throw new Error(`Unsupported archive format: ${archive_path}`);
}

async function normalizeBinary(bin_dir, binary_path) {
  const binary_names = process.platform === "win32"
    ? ["cli-proxy-api.exe", "CLIProxyAPI.exe"]
    : ["cli-proxy-api", "CLIProxyAPI"];
  const source_path = await findFirstFile(bin_dir, binary_names);
  if (!source_path) {
    throw new Error(`CLIProxyAPI binary not found after extraction in ${bin_dir}`);
  }
  if (source_path !== binary_path) {
    await fs.copyFile(source_path, binary_path);
  }
  if (process.platform !== "win32") {
    await fs.chmod(binary_path, 0o755);
  }
}

async function findFirstFile(root_dir, file_names) {
  const entries = await fs.readdir(root_dir, { withFileTypes: true });
  for (const entry of entries) {
    const current_path = path.join(root_dir, entry.name);
    if (entry.isFile() && file_names.includes(entry.name)) return current_path;
    if (entry.isDirectory()) {
      const found = await findFirstFile(current_path, file_names);
      if (found) return found;
    }
  }
  return null;
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? process.cwd(),
      stdio: options.stdio ?? "pipe",
      env: process.env,
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

function canConnect(host, port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    socket.setTimeout(1000);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(false));
  });
}

function escapeYaml(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const command = process.argv[2] ?? "install";
  if (command === "install") {
    const binary_path = await ensureCliProxy();
    const config_path = await writeCliProxyConfig();
    console.log(`CLIProxyAPI binary: ${binary_path}`);
    console.log(`CLIProxyAPI config: ${config_path}`);
    return;
  }
  if (command === "login-codex") {
    await runCliProxyLogin({ codex: true });
    return;
  }
  if (command === "login-claude-code") {
    await runCliProxyLogin({ claudeCode: true });
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
