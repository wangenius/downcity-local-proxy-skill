#!/usr/bin/env node

/**
 * Scaffold a standalone Downcity local proxy project from the bundled template.
 */

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const skill_dir = path.resolve(__dirname, "..");
const template_dir = path.join(skill_dir, "assets", "local-proxy-template");

const args = parse_args(process.argv.slice(2));
const target_dir = path.resolve(process.cwd(), args.target ?? "./downcity/local-proxy");

await assert_template();
await scaffold({
  source_dir: template_dir,
  target_dir,
  force: args.force,
});

console.log(`Created Downcity local proxy project: ${target_dir}`);
console.log("");
console.log("Next commands:");
console.log(`  cd ${shell_quote(target_dir)}`);
console.log("  pnpm install");
console.log("  pnpm start --codex");
console.log("  pnpm start --claude-code");

function parse_args(argv) {
  const out = {
    target: undefined,
    force: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--target") {
      out.target = argv[index + 1];
      index += 1;
      continue;
    }
    if (item === "--force") {
      out.force = true;
      continue;
    }
    if (item === "--help" || item === "-h") {
      print_help();
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${item}`);
  }

  return out;
}

function print_help() {
  console.log("Usage: create-local-proxy.mjs [--target ./downcity/local-proxy] [--force]");
}

async function assert_template() {
  const stat = await fs.stat(template_dir).catch(() => null);
  if (!stat?.isDirectory()) {
    throw new Error(`Template directory not found: ${template_dir}`);
  }
}

async function scaffold(options) {
  const existing = await fs.stat(options.target_dir).catch(() => null);
  if (existing && !options.force) {
    throw new Error(
      `Target already exists: ${options.target_dir}\nUse --force only if overwriting is intended.`,
    );
  }
  if (existing && options.force) {
    await fs.rm(options.target_dir, { recursive: true, force: true });
  }
  await copy_dir(options.source_dir, options.target_dir);
}

async function copy_dir(source_dir, target_dir) {
  await fs.mkdir(target_dir, { recursive: true });
  const entries = await fs.readdir(source_dir, { withFileTypes: true });
  for (const entry of entries) {
    const source_path = path.join(source_dir, entry.name);
    const target_path = path.join(target_dir, entry.name);
    if (entry.isDirectory()) {
      await copy_dir(source_path, target_path);
      continue;
    }
    if (entry.isFile()) {
      await fs.copyFile(source_path, target_path);
    }
  }
}

function shell_quote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}
