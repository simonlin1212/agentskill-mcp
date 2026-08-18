# Changelog

## v0.1.0 — 2026-08-18

First release.

Audited by an independent second model before publishing; two rounds, all P1 findings fixed and
re-verified. What that changed, in case it matters to you:

- Every URL the server fetches is validated against the site's exact origin, redirects are followed
  manually and re-checked per hop, and one deadline bounds the whole chain.
- Responses are counted in bytes while streaming, not buffered and measured afterwards.
- A single in-flight refresh publishes its snapshot atomically, so a concurrent call can never see a
  half-built search index.
- Anything not explicitly marked `free` is treated as paid, and paid records are sanitised on ingest
  rather than filtered on output.
- `test-guard.mjs` proves the guard blocks the shapes that bypass naive extension matching —
  extensionless download endpoints, object-storage links, percent-escaped extensions, lookalike domains.

- `search_capabilities` — search by free text, module, or price tier. Matches Chinese and English in one index.
- `get_capability` — full delivery facts for one capability: version, package size, last update, source, and how to obtain it.
- `list_modules` — catalog overview and what the two delivery forms mean.
- Catalog URL is discovered from `/llms.txt` rather than hardcoded, so the server keeps working when the site rotates it.
