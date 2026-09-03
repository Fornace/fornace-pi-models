# Changelog

## 1.0.0 (2026-09-03)

Initial release.

- Registers the `mantice` and `fornace` Pi providers from the authenticated
  Mantice catalog (`GET /v1/models`), one fetch per Pi process shared by both
  providers.
- `mantice` exposes chat rows plus routing aliases; `fornace` is groups only;
  embedding, image, and video surfaces are excluded.
- Committed `extensions/models-snapshot.json` as the offline fallback, used
  only when the live fetch fails, with a loud warning.
- `npm run audit`: spawns a real Pi process with a `session_start` probe that
  dumps the resolved model registry and asserts exact equality with the live
  catalog for both providers.
- Replaces the hand-maintained `mantice`/`fornace` blocks in
  `~/.pi/agent/models.json`, whose drift pinned `fornace-max` at 128,000/32,768
  while the gateway advertised 1,050,000/1,048,576.
