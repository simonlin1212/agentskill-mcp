# Changelog

## v0.1.0 — 2026-08-18

First release.

- `search_capabilities` — search by free text, module, or price tier. Matches Chinese and English in one index.
- `get_capability` — full delivery facts for one capability: version, package size, last update, source, and how to obtain it.
- `list_modules` — catalog overview and what the two delivery forms mean.
- Catalog URL is discovered from `/llms.txt` rather than hardcoded, so the server keeps working when the site rotates it.
