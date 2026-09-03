// Catalog-to-Pi model translation for the Mantice gateway.
// Single source of truth for the extension, the snapshot refresher, and the audit tool.
// Node 24 loads this file natively (erasable TypeScript only: no enums, no namespaces).

export interface CatalogRow {
  id: string;
  context_window?: number | null;
  max_output_tokens?: number | null;
  owned_by?: string | null;
}

export interface CatalogPayload {
  data?: unknown;
}

export interface PiModelEntry {
  id: string;
  name: string;
  input: Array<"text" | "image">;
  reasoning: boolean;
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
  contextWindow: number;
  maxTokens: number;
}

// Conservative defaults for catalog rows without published capacities.
export const DEFAULT_CONTEXT_WINDOW = 128_000;
export const DEFAULT_MAX_TOKENS = 16_384;
export const FORNACE_MAX_MIN_CONTEXT = 128_001;

export const PROVIDERS = ["mantice", "fornace"] as const;
export type ProviderId = (typeof PROVIDERS)[number];

// API keys stay in the OS keychain / env; only pi resolves them.
export const PROVIDER_API_KEYS: Record<ProviderId, string> = {
  mantice: "$MANTICE_API_KEY",
  fornace: "$FORNACE_LLM_API_KEY",
};

// The fornace provider mirrors the legacy curated list: groups only.
// mantice exposes every alias too, matching the alias policy of the gateway.
export const PROVIDER_ALIASES: Record<ProviderId, boolean> = {
  mantice: true,
  fornace: false,
};

export const DEFAULT_BASE_URL = "https://llm.fornace.net/v1";

export function baseUrlFromEnv(): string {
  return process.env.MANTICE_BASE_URL ?? DEFAULT_BASE_URL;
}

// Non-chat surfaces owned by Mantice routing. These ids are gateway-owned
// literals, not upstream model names, so a literal set is the contract.
const NON_CHAT_IDS = new Set([
  "embed",
  "fornace-embed",
  "text-embedding-v3",
  "image",
  "image-high",
  "image-lite",
  "image-max",
  "fornace-image",
  "fornace-image-high",
  "fornace-image-lite",
  "fornace-image-max",
  "video",
  "fornace-video",
  "reve-image",
]);

export function isAliasRow(row: CatalogRow): boolean {
  return typeof row.owned_by === "string" && row.owned_by.startsWith("alias:");
}

export function isChatRow(row: CatalogRow): boolean {
  return !NON_CHAT_IDS.has(row.id);
}

// Reasoning-capable routed ids (per Mantice deployment params and upstream cards).
const REASONING_IDS = new Set([
  "fornace-flash",
  "flash",
  "fornace-max",
  "max",
  "fornace-reasoning",
  "reasoning",
  "fornace-llm",
  "llm",
  "fornace-llm-fast",
  "llm-fast",
  "kimi",
  "fast",
  "fornace-fast",
]);

// Routed ids that accept image input (per upstream model cards).
const IMAGE_IDS = new Set([
  "fornace-vision",
  "vision",
  "eugeny-5.1-vision",
  "gemini-3-flash-preview",
  "gemini-3.5-flash",
  "gpt-5.5",
  "gpt-5.4-mini",
  "codex-gpt-5.6-test",
  "coding-plan",
  "gpt-coding-plan",
  "grok",
  "fornace-grok",
  "fornace-grok-fast",
  "fornace-max",
  "max",
  "kimi",
]);

const PRETTY_NAMES: Record<string, string> = {
  "fornace-max": "Fornace Max",
  "fornace-fast": "Fornace Fast",
  "fornace-flash": "Fornace Flash",
  "fornace-grok": "Fornace Grok",
  "fornace-grok-fast": "Fornace Grok Fast",
  "fornace-vision": "Fornace Vision",
  "fornace-llm": "Fornace LLM",
  "fornace-llm-fast": "Fornace LLM Fast",
  "fornace-reasoning": "Fornace Reasoning",
  kimi: "Kimi K3",
  max: "Max",
  fast: "Fast",
  reasoning: "Reasoning",
  llm: "LLM",
  "llm-fast": "LLM Fast",
  vision: "Vision",
  grok: "Grok",
  "coding-plan": "Coding Plan",
  "gpt-5.5": "GPT 5.5",
  "gpt-5.4-mini": "GPT 5.4 Mini",
  "gemini-3-flash-preview": "Gemini 3 Flash Preview",
  "gemini-3.5-flash": "Gemini 3.5 Flash",
  "glm-5.2-ondemand-max": "GLM 5.2 On Demand Max",
  "glm-5.2-ondemand-fast": "GLM 5.2 On Demand Fast",
  "glm-5.2-ondemand-reasoning": "GLM 5.2 On Demand Reasoning",
  "eugeny-max-pilot": "Eugeny Max Pilot",
  "eugeny-v6": "Eugeny V6",
  "eugeny-5.1": "Eugeny 5.1",
  "eugeny-5.1-vision": "Eugeny 5.1 Vision",
};

export function prettyName(id: string): string {
  return PRETTY_NAMES[id] ?? id;
}

export function parseCatalog(payload: unknown): CatalogRow[] {
  const data = (payload as CatalogPayload)?.data;
  if (!Array.isArray(data)) {
    throw new Error("Mantice /v1/models returned an unexpected payload: missing data array");
  }
  const rows: CatalogRow[] = [];
  for (const item of data) {
    if (typeof item?.id === "string" && item.id.length > 0) {
      rows.push(item as CatalogRow);
    }
  }
  return rows;
}

export function assertFornaceMaxCapacity(rows: CatalogRow[]): void {
  for (const id of ["fornace-max", "max"]) {
    const row = rows.find((candidate) => candidate.id === id);
    if (!row) {
      throw new Error(`Mantice catalog is missing required ${id} metadata`);
    }
    const context = row.context_window;
    if (typeof context !== "number" || context < FORNACE_MAX_MIN_CONTEXT) {
      throw new Error(
        `${id} context_window must exceed 128000; received ${String(context)}`,
      );
    }
  }
}

export function buildProviderModels(rows: CatalogRow[], provider: ProviderId): PiModelEntry[] {
  const models: PiModelEntry[] = [];
  for (const row of rows) {
    if (!isChatRow(row)) continue;
    if (!PROVIDER_ALIASES[provider] && isAliasRow(row)) continue;
    const contextWindow =
      typeof row.context_window === "number" && row.context_window > 0
        ? row.context_window
        : DEFAULT_CONTEXT_WINDOW;
    const maxTokens =
      typeof row.max_output_tokens === "number" && row.max_output_tokens > 0
        ? row.max_output_tokens
        : DEFAULT_MAX_TOKENS;
    models.push({
      id: row.id,
      name: prettyName(row.id),
      reasoning: REASONING_IDS.has(row.id),
      input: IMAGE_IDS.has(row.id) ? ["text", "image"] : ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow,
      maxTokens,
    });
  }
  models.sort((a, b) => a.id.localeCompare(b.id));
  return models;
}

export async function fetchCatalog(baseUrl: string, apiKey: string): Promise<CatalogRow[]> {
  const url = `${baseUrl.replace(/\/+$/, "")}/models`;
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`Mantice catalog fetch failed: HTTP ${response.status} from ${url}`);
  }
  return parseCatalog(await response.json());
}

export function rowsForSnapshot(rows: CatalogRow[]): CatalogRow[] {
  return rows
    .map((row) => ({
      id: row.id,
      context_window: row.context_window ?? null,
      max_output_tokens: row.max_output_tokens ?? null,
      owned_by: row.owned_by ?? null,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}
