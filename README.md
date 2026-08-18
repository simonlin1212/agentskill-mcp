<p align="center"><a href="README_zh.md">简体中文</a> | <b>English</b></p>

<h1 align="center">agentskill-mcp</h1>

<p align="center">
  <b>Let your agent find and install the capability it's missing</b><br>
  MCP server · curated catalog · free items download directly · Chinese and English search
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="MIT">
  <img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen" alt="node >=18">
  <img src="https://img.shields.io/badge/MCP-2026--07--28-blue" alt="MCP spec">
  <img src="https://img.shields.io/github/stars/simonlin1212/agentskill-mcp?style=flat" alt="stars">
</p>

<p align="center">
  <a href="#what-it-does">What it does</a> ·
  <a href="#install">Install</a> ·
  <a href="#tools">Tools</a> ·
  <a href="#what-the-catalog-contains">Catalog</a> ·
  <a href="#how-it-behaves">Behaviour</a> ·
  <a href="CHANGELOG.md">Changelog</a>
</p>

---

## What it does

Your agent hits a task it can't do — read A-share market data, get a second model to audit a diff,
transcribe an interview, remove a watermark, clone a site's design system. Somewhere out there is a
skill file that would solve it. Finding one is the annoying part.

This server puts a small, vetted catalog inside the agent. It searches, reads the delivery facts, and
tells you exactly what to run. Free items come with a direct download URL; paid ones come with a price
and no sales pitch.

The catalog is [agentskill.nz](https://agentskill.nz). It's deliberately small. Public skill directories
carry hundreds of thousands of entries with no vetting — measured average quality around 6 out of 12,
roughly a third carrying prompt-injection risk. Every entry here ships with what it does, what it needs
to run, what it was tested against, and where it stops.

## Install

No install step. Point your MCP client at it:

```json
{
  "mcpServers": {
    "agentskill": {
      "command": "npx",
      "args": ["-y", "@simonlin1212/agentskill-mcp"]
    }
  }
}
```

Claude Code:

```bash
claude mcp add agentskill -- npx -y @simonlin1212/agentskill-mcp
```

Requires Node 18+. Nothing to configure, no API key, no account. The server holds no state and writes
nothing to your machine.

## Tools

| Tool | What it answers |
|---|---|
| `search_capabilities` | "Is there something for X?" Filter by free text, module, or price tier. |
| `get_capability` | "What exactly am I getting, and how do I get it?" Version, package size, last update, source repository, and the obtain path. |
| `list_modules` | "What's in here?" The four modules, their counts, and what the two delivery forms mean. |

Search reads Chinese and English in one index, so `去水印` and `remove watermark` both land on the same
entry. Whichever you type, results carry both names.

## What the catalog contains

Four modules — Finance, Commerce, Creator, General — holding two forms:

- **Install Skill** — a skill file the agent loads. Copy it into the agent's skills directory.
- **Deploy App** — a runnable app with its own UI. Deploy it, then use it alongside the agent.

Roughly half the entries are free. Several are the packaged form of open-source repositories with a
combined 16,000+ GitHub stars; where a capability builds on an upstream project, the upstream and its
licence are named on the product page.

## How it behaves

This is a catalog tool, not an ad slot. Three rules it keeps:

- **Free means free.** Where the catalog publishes a download URL, the tool hands it straight over —
  no account, no gate. (A free entry can occasionally have no published archive yet; it says so.)
- **Paid states the price and stops.** No urgency, no recommendation language. The download link for a
  paid item is issued after checkout, on the order page and by email.

  Concretely: anything the catalog does not explicitly mark `free` is treated as paid (fail closed), its
  download field is dropped, URLs are stripped out of its name, outcome, install, source and
  repository fields, and the assembled output is
  checked against a route allowlist. The only web addresses that survive are, on `https://agentskill.nz`
  (optionally under `/zh`): the site root, `/products/<handle>`, `/collections/<handle>`,
  `/pages/<handle>`, and `/cart` or `/cart/<variant>:<qty>` — each matched as a whole route, so a deeper
  path like `/products/x/download` does not qualify. Anything else — another host, plain http, a lookalike
  domain, `/download?id=…` — makes the server refuse to return that record.

  What this does not cover: a bare hostname with no scheme (`evil.example/x`). Catching those means
  treating any domain-shaped text as an address, and `.md` is a real TLD — `SKILL.md` in a delivery
  manifest would be rejected as a domain, breaking every paid listing. These responses are plain text,
  so a bare hostname only becomes a link if something downstream linkifies it.

  The gap worth naming: the catalog is cached for up to five minutes. An item that turned paid inside
  that window is still described from the previous snapshot — **including the direct download URL it had
  while it was free**.
- **An install command is information, not authorization.** `get_capability` — the only tool that returns
  an install command — says so on every call. Your agent should confirm with you before writing to your
  filesystem or spending your money.

The catalog URL is discovered from the site's `/llms.txt` at runtime rather than hardcoded, so the
server keeps working when the site rotates it.

## Building from source

```bash
npm install
npm run build
node test-smoke.mjs    # drives the server over real MCP stdio
```

`test-smoke.mjs` speaks the wire protocol rather than importing the module, so it catches registration
and transport breakage that a unit test would miss. It also asserts that no paid item ever returns a
file URL.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

## Disclaimer

This server reads a catalog and returns what it says. It does not evaluate whether a capability suits
your use case, and it does not execute anything. Skill files are code your agent will read and act on —
review them before use, the same as any dependency.

## Support

If this saved you some time ☕

<p align="center">
  <a href="https://buymeacoffee.com/simonlin1212"><img src="./assets/bmc-qr.png" width="180" alt="Buy Me a Coffee"></a>
</p>

## License

MIT

**Author:** Simon Lin · X [@linsizhen](https://x.com/linsizhen) · Email: [simonlin0423@gmail.com](mailto:simonlin0423@gmail.com)
