// fornace-pi-models: keeps interactive Pi model metadata in sync with the
// authenticated Mantice catalog at https://llm.fornace.net/v1/models.
// The catalog is the single source of truth; this extension never carries
// hand-written capacities. A committed snapshot is the offline fallback only.

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import {
  PROVIDERS,
  PROVIDER_API_KEYS,
  assertFornaceMaxCapacity,
  buildProviderModels,
  fetchCatalog,
  parseCatalog,
  baseUrlFromEnv,
  type CatalogRow,
  type ProviderId,
} from "../src/catalog.ts";

const COMPAT = {
  supportsDeveloperRole: false,
  supportsReasoningEffort: false,
  supportsStore: false,
  maxTokensField: "max_tokens" as const,
};

const SNAPSHOT_PATH = join(dirname(fileURLToPath(import.meta.url)), "models-snapshot.json");

let catalogPromise: Promise<CatalogRow[]> | undefined;

async function loadSnapshot(): Promise<CatalogRow[]> {
  const raw = await readFile(SNAPSHOT_PATH, "utf8");
  const rows = parseCatalog({ data: JSON.parse(raw) });
  assertFornaceMaxCapacity(rows);
  return rows;
}

async function resolveCatalog(): Promise<CatalogRow[]> {
  // Resolve once per process. Pi may invoke refreshModels repeatedly while
  // composing providers; duplicate network attempts only add latency and noise.
  catalogPromise ??= (async () => {
    const baseUrl = baseUrlFromEnv();
    const key = process.env.MANTICE_API_KEY;
    if (key) {
      try {
        const rows = await fetchCatalog(baseUrl, key);
        if (rows.length === 0) {
          throw new Error(`Mantice catalog at ${baseUrl} returned zero models`);
        }
        assertFornaceMaxCapacity(rows);
        return rows;
      } catch (error) {
        console.error(`[fornace-pi-models] live catalog fetch failed: ${String(error)}`);
      }
    } else {
      console.error("[fornace-pi-models] MANTICE_API_KEY not set; cannot fetch live catalog");
    }
    const rows = await loadSnapshot();
    console.error(
      `[fornace-pi-models] WARNING: using committed snapshot (${rows.length} models); live catalog unavailable`,
    );
    return rows;
  })();
  return catalogPromise;
}

function providerModels(rows: CatalogRow[], provider: ProviderId): ProviderModelConfig[] {
  return buildProviderModels(rows, provider).map((model) => ({ ...model, compat: COMPAT }));
}

export default async function register(api: ExtensionAPI) {
  let rows: CatalogRow[];
  try {
    rows = await resolveCatalog();
  } catch (error) {
    console.error(
      `[fornace-pi-models] catalog unavailable, providers registered empty: ${String(error)}`,
    );
    rows = [];
  }
  for (const provider of PROVIDERS) {
    api.registerProvider(provider, {
      baseUrl: baseUrlFromEnv(),
      api: "openai-completions",
      apiKey: PROVIDER_API_KEYS[provider],
      models: providerModels(rows, provider),
      refreshModels: async () => providerModels(await resolveCatalog(), provider),
    });
  }
}
