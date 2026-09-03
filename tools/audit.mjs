// Audit: verifies that a real Pi process registers exactly the models and
// capacities the authenticated Mantice catalog publishes, for both providers
// (mantice with aliases, fornace without). Exits non-zero on any mismatch.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PROVIDERS,
  assertFornaceMaxCapacity,
  baseUrlFromEnv,
  buildProviderModels,
  fetchCatalog,
} from "../src/catalog.ts";

const key = process.env.MANTICE_API_KEY;
if (!key) {
  console.error("MANTICE_API_KEY is required to audit against the live catalog");
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));

const rows = await fetchCatalog(baseUrlFromEnv(), key);
assertFornaceMaxCapacity(rows);
const expected = Object.fromEntries(PROVIDERS.map((p) => [p, buildProviderModels(rows, p)]));

const outPath = join(mkdtempSync(join(tmpdir(), "fornace-audit-")), "registry.json");
const probe = join(here, "audit-probe.ts");

const run = spawnSync(
  "pi",
  [
    "-e", probe,
    "--no-session",
    "--no-context-files",
    "--no-skills",
    "--no-themes",
    "--mode", "json",
    "--provider", "mantice",
    "--model", "fornace-fast",
    "-p", "Reply with the single word: ok",
  ],
  {
    env: { ...process.env, FORNACE_AUDIT_OUT: outPath },
    encoding: "utf8",
    timeout: 120_000,
  },
);

if (run.status !== 0) {
  console.error(`pi probe exited with status ${run.status}`);
  console.error(run.stderr || run.stdout);
  process.exit(1);
}

const actualAll = JSON.parse(readFileSync(outPath, "utf8"));
let failures = 0;
let checks = 0;

for (const provider of PROVIDERS) {
  const actual = new Map(
    actualAll.filter((m) => m.provider === provider).map((m) => [m.id, m]),
  );
  const wanted = new Map(expected[provider].map((m) => [m.id, m]));

  for (const [id, model] of wanted) {
    checks++;
    const got = actual.get(id);
    if (!got) {
      console.error(`FAIL ${provider}/${id}: registered nowhere in Pi`);
      failures++;
      continue;
    }
    for (const field of ["contextWindow", "maxTokens", "reasoning"]) {
      if (got[field] !== model[field]) {
        console.error(
          `FAIL ${provider}/${id} ${field}: catalog=${model[field]} pi=${got[field]}`,
        );
        failures++;
      }
    }
    const wantImages = model.input.includes("image");
    const gotImages = got.input?.includes("image") ?? false;
    if (wantImages !== gotImages) {
      console.error(`FAIL ${provider}/${id} image input: catalog=${wantImages} pi=${gotImages}`);
      failures++;
    }
  }

  for (const id of actual.keys()) {
    if (!wanted.has(id)) {
      console.error(`FAIL ${provider}/${id}: registered in Pi but absent from catalog policy`);
      failures++;
    }
  }
}

if (failures === 0) {
  console.log(
    `audit OK: ${checks} model entries match the live catalog (${rows.length} catalog rows)`,
  );
} else {
  console.error(`audit FAILED: ${failures} mismatches`);
  process.exit(1);
}
