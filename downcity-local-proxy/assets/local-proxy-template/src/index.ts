/**
 * Downcity 本地 Federation 入口。
 *
 * 关键点（中文）：
 * - 本服务只在本机运行，作为 Downcity agent 的模型能力代理。
 * - 上游模型全部经由 CLIProxyAPI，本服务不直接处理 Codex / Claude Code OAuth。
 * - HTTP 入口自动注入 admin secret，方便本机调试和 agent 访问。
 */

import "dotenv/config";

import { mkdirSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join } from "node:path";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { buffer } from "node:stream/consumers";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { AIService, Federation, sqliteEnv, type FederationOptions } from "@downcity/city";
import { AccountsService, BalanceService } from "@downcity/services";

import { models } from "./models.js";

const PORT = Number(process.env.PORT ?? 3000);
const DATABASE_PATH = process.env.DATABASE_PATH ?? "./data/local.db";
const PUBLIC_URL = process.env.PUBLIC_URL ?? `http://127.0.0.1:${PORT}`;
const CONFIGURED_ADMIN_SECRET = process.env.DOWNCITY_FEDERATION_ADMIN_SECRET_KEY;
const LOCAL_CITY_ID = process.env.DOWNCITY_LOCAL_CITY_ID ?? "vibecape";
const LOCAL_CITY_NAME = process.env.DOWNCITY_LOCAL_CITY_NAME ?? "Vibecape";
const INITIAL_BALANCE_CREDITS = 10_000;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
  "Access-Control-Max-Age": "86400",
};

mkdirSync(join(process.cwd(), "data"), { recursive: true });

const sqlite = new Database(join(process.cwd(), DATABASE_PATH));
const drizzle_db = drizzle(sqlite);
const db = Object.assign(drizzle_db, { $client: sqlite }) as unknown as FederationOptions["db"];

const fed = new Federation({ db });
fed.use(new AccountsService({ local_login: true }));

const balance = new BalanceService({ init_credits: INITIAL_BALANCE_CREDITS });
const ai = new AIService({
  balance: {
    precheck: (user_id, needed_credits) => balance.precheck(user_id, needed_credits),
    charge: (input) => balance.charge(input),
  },
}).use(models);

fed.use(balance);
fed.use(ai);

await fed.health();
await ensureLocalCity(fed, LOCAL_CITY_ID, LOCAL_CITY_NAME);
await seedEnv(fed, {
  CLIPROXY_API_KEY: process.env.CLIPROXY_API_KEY ?? "downcity-local-proxy",
  ...(CONFIGURED_ADMIN_SECRET ? { DOWNCITY_FEDERATION_ADMIN_SECRET_KEY: CONFIGURED_ADMIN_SECRET } : {}),
});

const ADMIN_SECRET_KEY = CONFIGURED_ADMIN_SECRET || await readAdminKey(drizzle_db) || "";

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  try {
    const url = new URL(req.url ?? "/", PUBLIC_URL);

    if (req.method === "OPTIONS") {
      applyCors(res);
      res.statusCode = 204;
      res.end();
      return;
    }

    if (req.method === "GET" && url.pathname === "/") {
      applyCors(res);
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Downcity local proxy is ready.");
      return;
    }

    if (req.method === "GET" && url.pathname === "/health") {
      const health = await fed.health();
      applyCors(res);
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ...health, models: models.map((model) => model.id) }));
      return;
    }

    const request = injectAdminAuth(await buildRequest(req, url));
    const response = await fed.fetch(request, {
      execution: {
        waitUntil(promise: Promise<unknown>) {
          promise.catch((error: unknown) => {
            console.error("[waitUntil] background task failed", error);
          });
        },
      },
    });
    await sendResponse(res, response);
  } catch (error) {
    applyCors(res);
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: String(error) }));
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[downcity-local-proxy] Federation listening on ${PUBLIC_URL}`);
  console.log(`[downcity-local-proxy] Models: ${models.map((model) => model.id).join(", ")}`);
});

async function seedEnv(
  federation: Federation,
  env: Record<string, string>,
): Promise<void> {
  for (const [key, value] of Object.entries(env)) {
    const response = await federation.fetch(
      new Request(`${PUBLIC_URL}/v1/env/upsert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value }),
      }),
      { trusted_identity: { level: "admin" } },
    );
    if (!response.ok) {
      throw new Error(`Failed to seed env ${key}: ${response.status} ${await response.text()}`);
    }
  }
}

type LocalCityRecord = {
  city_id: string;
  name: string;
  status: string;
  created_at: string;
  updated_at: string;
};

async function ensureLocalCity(
  federation: Federation,
  city_id: string,
  name: string,
): Promise<void> {
  const normalized_city_id = city_id.trim();
  if (!normalized_city_id) return;

  const cities = await federation.table<LocalCityRecord>("cities");
  const existing = (await cities.select({ city_id: normalized_city_id }))[0];
  if (!existing) {
    const now = new Date().toISOString();
    await cities.insert({
      city_id: normalized_city_id,
      name,
      status: "active",
      created_at: now,
      updated_at: now,
    });
    return;
  }

  if (existing.status !== "active") {
    await cities.update({
      where: { city_id: normalized_city_id },
      values: { status: "active", updated_at: new Date().toISOString() },
    });
  }
}

async function readAdminKey(db_handle: ReturnType<typeof drizzle>): Promise<string | undefined> {
  const rows = await db_handle
    .select({ value: sqliteEnv.value })
    .from(sqliteEnv)
    .where(eq(sqliteEnv.key, "DOWNCITY_FEDERATION_ADMIN_SECRET_KEY"))
    .limit(1);
  return rows[0]?.value;
}

function injectAdminAuth(request: Request): Request {
  const headers = new Headers(request.headers);
  if (!headers.has("authorization") && ADMIN_SECRET_KEY) {
    headers.set("Authorization", `Bearer ${ADMIN_SECRET_KEY}`);
  }
  return new Request(request, { headers });
}

async function buildRequest(req: IncomingMessage, url: URL): Promise<Request> {
  const body = req.method !== "GET" && req.method !== "HEAD" ? await buffer(req) : undefined;
  return new Request(url.toString(), {
    method: req.method,
    headers: buildHeaders(req),
    body,
  });
}

function buildHeaders(req: IncomingMessage): Headers {
  const entries: [string, string][] = [];
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) entries.push([key, item]);
    } else {
      entries.push([key, String(value)]);
    }
  }
  return new Headers(entries);
}

async function sendResponse(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;
  for (const [key, value] of response.headers) {
    res.setHeader(key, value);
  }
  applyCors(res);

  if (response.body) {
    const stream = Readable.fromWeb(response.body as unknown as NodeReadableStream<Uint8Array>);
    stream.pipe(res);
  } else {
    res.end();
  }
}

function applyCors(res: ServerResponse): void {
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    res.setHeader(key, value);
  }
}
