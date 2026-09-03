# fornace-pi-models

Keeps [Pi](https://github.com/badlogic/pi-mono) model metadata in sync with the
authenticated Mantice catalog at `https://llm.fornace.net/v1/models`.

Pi used to read hand-maintained `models.json` entries for the `mantice` and
`fornace` providers. Those entries drifted from the live routing table: stale
models, mismatched context windows, and capacities that lagged upstream cards.
This extension deletes that class of error: every Pi startup resolves the model
list from the authenticated catalog, which is computed by Mantice from its
routing groups, deployment params, and upstream model cards.

## How it works

- One authenticated `GET /v1/models` per Pi startup (shared by both providers).
- Chat-capable rows become Pi models. Embedding, image, and video surfaces are
  excluded; the `mantice` provider additionally exposes routing aliases
  (`max`, `fast`, `vision`, ...), while `fornace` keeps the curated group-only
  list.
- Capacities, reasoning flags, and image-input flags come from the catalog and
  its routing knowledge, never from this repo.
- A committed `extensions/models-snapshot.json` is the offline fallback. It is
  used only when the gateway is unreachable, and its use is logged loudly.

## Install

```sh
pi install git:github.com/Fornace/fornace-pi-models
# or, from a checkout:
pi install /path/to/fornace-pi-models
```

Requires `MANTICE_API_KEY` in the environment (the key used for
`llm.fornace.net`). Optional: `MANTICE_BASE_URL` to point at another gateway.

Remove any hand-written `mantice`/`fornace` blocks from `~/.pi/agent/models.json`;
the extension owns both providers.

## Verify

```sh
npm test          # unit tests for the catalog translation
npm run snapshot  # refresh extensions/models-snapshot.json from the live catalog
npm run audit     # launch a real Pi process and compare its registry to the live catalog
npm run audit:fornace-max  # require every live fallback deployment to exceed 128K input
```

The registry audit spawns `pi` with a probe extension that dumps the resolved
model registry at session start, then asserts exact equality of model
membership, `contextWindow`, `maxTokens`, reasoning, and image-input flags
against the authenticated catalog for both providers. The fallback-chain audit
requires `MANTICE_ADMIN_TOKEN`; it traverses `fornace-max` and its group
fallbacks, joins every enabled deployment to its model card, and fails if any
input context is 128K or smaller.

## Layout

- `src/catalog.ts`: catalog parsing, provider policy, and model building. Loaded
  natively by Node and by Pi's extension loader.
- `extensions/mantice-models.ts`: the Pi extension entry point.
- `extensions/models-snapshot.json`: committed offline fallback.
- `tools/refresh-snapshot.mjs`, `tools/audit.mjs`, `tools/audit-probe.ts`:
  maintenance and verification.
