// Stub tests: exercise the catalog translation logic without launching pi.
import assert from "node:assert/strict";
import {
  assertFornaceMaxCapacity,
  buildProviderModels,
  isAliasRow,
  isChatRow,
  parseCatalog,
  prettyName,
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_MAX_TOKENS,
} from "../src/catalog.ts";

const rows = parseCatalog({
  data: [
    { id: "fornace-max", context_window: 1050000, max_output_tokens: 1048576, owned_by: "routing" },
    { id: "max", context_window: 1050000, max_output_tokens: 1048576, owned_by: "alias:fornace-max" },
    { id: "fornace-vision", context_window: 1000000, max_output_tokens: 131072, owned_by: "routing" },
    { id: "fornace-embed", context_window: null, max_output_tokens: 4096, owned_by: "routing" },
    { id: "image", context_window: 128000, max_output_tokens: 32768, owned_by: "alias:fornace-image" },
    { id: "eugeny-v6", context_window: null, max_output_tokens: null, owned_by: "routing" },
    { id: "kimi", context_window: 1048576, max_output_tokens: 1048576, owned_by: "routing" },
  ],
});

assertFornaceMaxCapacity(rows);
const mantice = buildProviderModels(rows, "mantice");
const fornace = buildProviderModels(rows, "fornace");

const byId = (models, id) => models.find((m) => m.id === id);

// Chat rows survive, non-chat surfaces (embeddings, image, video) are excluded.
assert.ok(byId(mantice, "fornace-max"), "fornace-max present for mantice");
assert.ok(byId(mantice, "eugeny-v6"), "chat rows with unknown capacity stay usable");
assert.ok(!byId(mantice, "fornace-embed"), "embedding groups excluded");
assert.ok(!byId(mantice, "image"), "image aliases excluded");
assert.ok(isChatRow({ id: "fornace-max" }), "chat detection for routed rows");
assert.ok(!isChatRow({ id: "fornace-video" }), "video excluded from chat");
assert.ok(isAliasRow({ id: "max", owned_by: "alias:fornace-max" }), "alias detection");
assert.ok(!isAliasRow({ id: "fornace-max", owned_by: "routing" }), "routing rows are not aliases");

// Aliases are exposed on mantice only.
assert.ok(byId(mantice, "max"), "aliases exposed on mantice");
assert.ok(!byId(fornace, "max"), "aliases hidden on fornace");

// Capacities come from the catalog, never hand-written.
const max = byId(mantice, "fornace-max");
assert.equal(max.contextWindow, 1050000);
assert.equal(max.maxTokens, 1048576);
assert.equal(max.reasoning, true);
assert.equal(max.input.includes("image"), true, "fornace-max accepts images");

const v6 = byId(mantice, "eugeny-v6");
assert.equal(v6.contextWindow, DEFAULT_CONTEXT_WINDOW, "unknown capacity falls back conservatively");
assert.equal(v6.maxTokens, DEFAULT_MAX_TOKENS);

const kimi = byId(mantice, "kimi");
assert.equal(kimi.reasoning, true);
assert.equal(prettyName("kimi"), "Kimi K3");
assert.equal(prettyName("unknown-model-id"), "unknown-model-id");

// Entries satisfy the required ProviderModelConfig fields.
for (const model of [...mantice, ...fornace]) {
  assert.equal(typeof model.id, "string");
  assert.equal(typeof model.name, "string");
  assert.equal(typeof model.reasoning, "boolean");
  assert.ok(Array.isArray(model.input) && model.input.length > 0);
  assert.equal(typeof model.contextWindow, "number");
  assert.equal(typeof model.maxTokens, "number");
  assert.deepEqual(model.cost, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
}

// Malformed payloads fail loudly instead of yielding a silent empty list.
assert.throws(() => parseCatalog({}), /missing data array/);
assert.throws(() => parseCatalog(null), /missing data array/);
assert.throws(
  () => assertFornaceMaxCapacity(rows.filter((row) => row.id !== "max")),
  /missing required max metadata/,
);
assert.throws(
  () => assertFornaceMaxCapacity(rows.map((row) =>
    row.id === "fornace-max" ? { ...row, context_window: 128000 } : row)),
  /must exceed 128000/,
);

console.log(`load.mjs OK: mantice=${mantice.length} fornace=${fornace.length} models from 7 catalog rows`);
