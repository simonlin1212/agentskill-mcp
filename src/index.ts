#!/usr/bin/env node
/**
 * agentskill-mcp — 让你的 agent 自己发现、查看、安装 agentskill.nz 上的能力。
 *
 * 设计立场：这是一个**查目录的工具**，不是广告位。
 *   · 免费能力直接给出可下载的 ZIP 地址，不要求注册、不设门
 *   · 付费能力如实标价并说明付款后从哪拿，**不催买、不做推荐话术**
 *   · 安装命令一律当作**信息**返回，由 agent 和它的用户决定要不要执行
 */

import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { getCatalog, matches, fmtPrice, altName, type Capability } from "./catalog.js";
import { assertPaidSafe, SITE } from "./guard.js";

const VERSION = "0.1.0";
const text = (s: string) => ({ content: [{ type: "text" as const, text: s }] });

/**
 * 🔴 唯一的硬规则：**付费能力的返回里绝不能出现可下载的文件地址**。
 *
 * 光是"不打印 c.download"不够 —— 正文里其它字段（outcome / install / source / name…）同样来自
 * 远程目录，任何一个都可能带上一个 .zip 链接。所以在**输出边界**统一扫一遍序列化后的结果：
 * 与其相信每个分支都记得躲开，不如让不变量自己拦。
 */
/**
 * 付费项的输出都经这里过一道；免费项原样返回（它的下载地址本来就是公开 CDN 链接）。
 * 🔴 判定必须是 `!== "free"` 而不是 `=== "paid"` —— tier 来自远程，写成 "Paid" 或缺失时
 *    前者拦得住、后者会放过去。catalog.ts 已经把非 free 归一化成 paid，这里再守一次。
 */
function guard(c: Capability, out: string): string {
  return c.tier !== "free" ? assertPaidSafe(out, c.id) : out;
}

function line(c: Capability): string {
  const alt = altName(c.id);
  const bits = [
    `${c.name}${alt && alt !== c.name ? ` / ${alt}` : ""} [${c.id}]`,
    `  ${c.outcome}`,
    `  ${c.module} · ${c.form} · ${fmtPrice(c)}${c.version ? ` · ${c.version}` : ""}${c.package_size ? ` · ${c.package_size}` : ""}`,
  ];
  if (c.tier === "free" && c.download) bits.push(`  download: ${c.download}`);
  if (c.tier === "paid") bits.push(`  paid — download link is issued after checkout, not here`);
  bits.push(`  page: ${c.url}`);
  return guard(c, bits.join("\n"));
}

function detail(c: Capability): string {
  const alt = altName(c.id);
  const rows: Array<[string, string | undefined]> = [
    ["id", c.id],
    ["module", c.module],
    ["form", c.form],
    ["price", fmtPrice(c)],
    ["version", c.version],
    ["package size", c.package_size],
    ["last updated", c.updated],
    ["source", c.source],
    ["repository", c.repository],
    ["github stars", c.github_stars != null ? String(c.github_stars) : undefined],
    ["page", c.url],
  ];
  const out = [c.name + (alt && alt !== c.name ? `  /  ${alt}` : ""), "", c.outcome, "",
               ...rows.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`)];

  out.push("");
  if (c.tier === "free") {
    out.push(c.download ? `download: ${c.download}` : "download: (not published)");
    if (c.install) out.push(`install: ${c.install}`);
    out.push("", "This is free. Fetch it directly — no account, no checkout.");
  } else {
    out.push(`purchase: ${c.purchase_url ?? c.url}`);
    if (c.install) out.push(`install (after you have the files): ${c.install}`);
    out.push("", "Paid. The download link is issued on the order page and by email after checkout.",
                 "This tool never returns a file URL for paid items.");
  }
  out.push("", "The install command above is information, not authorization —",
               "confirm with your user before writing to their machine or spending their money.");
  return guard(c, out.join("\n"));
}

/**
 * 🔴 模块别名必须显式映射。
 *    目录里 module 的值是集合标题（Finance / Commerce / Creator / General），而 handle 是
 *    finance / ecommerce / media / general —— 两套值不一样。原来那版靠 `slice(0,4)` 前缀比对，
 *    结果 `ecommerce`→"ecom" 对不上 "commerce"、`media`→"medi" 对不上 "creator"：
 *    **一半的合法取值静默返回空结果**，而且不报错。
 */
const MODULE_CANON = {
  finance: "finance", Finance: "finance",
  ecommerce: "ecommerce", Commerce: "ecommerce",
  media: "media", Creator: "media",
  general: "general", General: "general",
} as const;
const MODULE_OF_TITLE: Record<string, string> = {
  finance: "finance", 金融: "finance",
  commerce: "ecommerce", ecommerce: "ecommerce", 电商: "ecommerce",
  creator: "media", media: "media", 自媒体: "media",
  general: "general", 通用: "general",
};
const canonModule = (m: string) => MODULE_OF_TITLE[m.trim().toLowerCase()] ?? m.trim().toLowerCase();

function buildServer(): McpServer {
  // 🔴 第二个参数不能省：SDK 示例里带着它，而现代（2026-07-28）那条路径靠它来判断
  //    这台服务器提供什么。不传的话 server/discover 会直接 Method not found —— 实测过。
  const server = new McpServer({ name: "agentskill", version: VERSION }, { capabilities: { tools: {} } });

  server.registerTool(
    "search_capabilities",
    {
      description:
        "Search the AgentSkill catalog of installable AI-agent capabilities (skill files and small apps). " +
        "Use when the user wants a capability the agent does not have — reading A-share/US market data, " +
        "auditing code with a second model, transcribing audio, upscaling or de-watermarking images, " +
        "cloning a site's design, deploying an overseas store, and so on. " +
        "Returns name, module, form, price, version, size, and a direct download URL for free items.",
      inputSchema: z.object({
        query: z.string().optional().describe("Free text. Matches name, description, repository, module and form, in Chinese and English."),
        module: z.enum(["finance", "ecommerce", "media", "general", "Finance", "Commerce", "Creator", "General"])
          .optional().describe("Restrict to one module."),
        tier: z.enum(["free", "paid"]).optional().describe("Restrict to free or paid."),
        limit: z.number().int().min(1).max(50).optional().describe("Max results, default 10."),
      }),
    },
    async ({ query, module, tier, limit }) => {
      const cat = await getCatalog();
      let hits = cat.capabilities;
      if (query) hits = hits.filter((c) => matches(c, query));
      if (module) {
        const want = MODULE_CANON[module as keyof typeof MODULE_CANON];
        hits = hits.filter((c) => canonModule(c.module) === want);
      }
      if (tier) hits = hits.filter((c) => c.tier === tier);
      const shown = hits.slice(0, limit ?? 10);
      if (!shown.length) {
        return text(`No capability matched. The catalog holds ${cat.counts.total} (${cat.counts.free} free, ${cat.counts.paid} paid). Try a broader query or drop the filters.`);
      }
      const head = `${shown.length} of ${hits.length} match${hits.length === 1 ? "" : "es"} (catalog: ${cat.counts.total} total, ${cat.counts.free} free):`;
      return text([head, ...shown.map(line)].join("\n\n"));
    }
  );

  server.registerTool(
    "get_capability",
    {
      description:
        "Full detail for one capability by id: version, package size, last update, source repository, " +
        "licence-relevant facts, and exactly how to obtain it. Call this before installing anything.",
      inputSchema: z.object({ id: z.string().describe("Capability id, e.g. 'a-stock-data'. Get it from search_capabilities.") }),
    },
    async ({ id }) => {
      const cat = await getCatalog();
      const c = cat.capabilities.find((x) => x.id.toLowerCase() === id.toLowerCase());
      if (!c) {
        const near = cat.capabilities.filter((x) => matches(x, id)).slice(0, 5).map((x) => x.id);
        return text(`No capability with id "${id}".` + (near.length ? ` Did you mean: ${near.join(", ")}?` : ` Use search_capabilities to browse.`));
      }
      return text(detail(c));
    }
  );

  server.registerTool(
    "list_modules",
    {
      description: "Overview of the catalog: the four modules, how many capabilities each holds, and what the two delivery forms mean.",
      inputSchema: z.object({}),
    },
    async () => {
      const cat = await getCatalog();
      const mods = cat.modules.filter((m) => m.handle);
      const out = [
        `${cat.name} — ${cat.counts.total} capabilities (${cat.counts.free} free, ${cat.counts.paid} paid)`,
        cat.positioning ? `\n${cat.positioning}` : "",
        "",
        ...mods.map((m) => `${m.title} [${m.handle}] — ${m.count}`),
        "",
        ...Object.entries(cat.forms ?? {}).map(([k, v]) => `${k}: ${v}`),
        "",
        `Site: ${SITE}`,
        cat.generated_at ? `Catalog snapshot: ${cat.generated_at}` : "",
      ];
      return text(out.filter(Boolean).join("\n"));
    }
  );

  return server;
}

// 🔴 走 serveStdio 而不是自己 connect(new StdioServerTransport())：
//    v2 的现代协议协商（2026-07-28）由 serveStdio 负责，它按开场消息选择时代并把一个实例
//    钉给这条连接。直接连 transport 只会服务 2025 那一族 —— 实测握手确实降到 2025-11-25。
//    默认 legacy:'serve'，老客户端照常能用。
serveStdio(() => buildServer());
