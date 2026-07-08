/**
 * CLIProxyAPI 模型注册。
 *
 * 关键点（中文）：
 * - Downcity 只面对一个 OpenAI-compatible 上游：CLIProxyAPI。
 * - Codex / Claude Code 的 OAuth、账号池和模型路由由 CLIProxyAPI 负责。
 * - 本文件只把本地可选模型声明成 Federation AIService models。
 */

import { createOpenAI } from "@ai-sdk/openai";
import { Provider } from "@downcity/city";
import type { ModelConfig, OpenAICompatibleClientConfig } from "@downcity/city";

const DEFAULT_CLIPROXY_BASE_URL = "http://127.0.0.1:8317/v1";
const CLIPROXY_API_KEY_ENV = "CLIPROXY_API_KEY";

interface LocalModelSpec {
  /** Downcity 对外暴露的模型 ID。 */
  id: string;
  /** CLIProxyAPI 上游真实模型 ID。 */
  upstream_model: string;
}

interface CliProxyProviderOptions {
  /** Provider 唯一 ID。 */
  id: string;
  /** 标签前缀，用于模型目录展示。 */
  label: string;
  /** 模型标签。 */
  tags: string[];
  /** 模型配置列表。 */
  models: LocalModelSpec[];
}

class CliProxyProvider extends Provider {
  constructor(options: {
    /** Provider 唯一 ID。 */
    id: string;
    /** 默认透传模型，实际模型可被 model meta 覆盖。 */
    default_model: string;
  }) {
    super({
      id: options.id,
      env: { [CLIPROXY_API_KEY_ENV]: "CLIProxyAPI API Key" },
      envKey: CLIPROXY_API_KEY_ENV,
      baseURL: process.env.CLIPROXY_API_BASE_URL ?? DEFAULT_CLIPROXY_BASE_URL,
      passthroughModel: options.default_model,
    });
  }

  protected createClient(config: OpenAICompatibleClientConfig) {
    return createOpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    });
  }
}

export const models: ModelConfig[] = [
  ...createProviderModels({
    id: "cliproxy-codex",
    label: "Codex",
    tags: ["cliproxy", "codex", "text"],
    models: parseModelSpecs(
      process.env.DOWNCITY_CODEX_MODELS,
      "codex-gpt-5-5=gpt-5.5,codex-gpt-5-codex=gpt-5-codex",
    ),
  }),
  ...createProviderModels({
    id: "cliproxy-claude-code",
    label: "Claude Code",
    tags: ["cliproxy", "claude-code", "text"],
    models: parseModelSpecs(
      process.env.DOWNCITY_CLAUDE_CODE_MODELS,
      "claude-code-sonnet=claude-sonnet-4.6",
    ),
  }),
].filter((model) => enabledModelGroups().has(String(model.meta?.group ?? "")));

function createProviderModels(options: CliProxyProviderOptions): ModelConfig[] {
  const default_model = options.models[0]?.upstream_model ?? options.models[0]?.id ?? "";
  if (!default_model) return [];

  const provider = new CliProxyProvider({
    id: options.id,
    default_model,
  });

  return options.models.map((model) =>
    provider.model({
      id: model.id,
      name: `${options.label} · ${model.upstream_model}`,
      description: `${options.label} via CLIProxyAPI (${model.upstream_model})`,
      tags: options.tags,
      meta: {
        group: options.id === "cliproxy-codex" ? "codex" : "claude-code",
        upstream_model: model.upstream_model,
      },
    })
  );
}

function parseModelSpecs(input: string | undefined, fallback: string): LocalModelSpec[] {
  return String(input || fallback)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const [left, right] = item.split("=").map((part) => part.trim());
      const id = sanitizeModelId(left);
      const upstream_model = right || left;
      return { id, upstream_model };
    });
}

function sanitizeModelId(input: string): string {
  return input.replace(/[^a-zA-Z0-9._:-]+/gu, "-").replace(/^-+|-+$/gu, "");
}

function enabledModelGroups(): Set<string> {
  const groups = String(process.env.DOWNCITY_LOCAL_MODELS || "codex,claude-code")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return new Set(groups);
}
