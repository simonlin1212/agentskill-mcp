/**
 * 取 agentskill.nz 的机器目录。
 *
 * 🔴 目录 URL 是**发现出来的，不是写死的**：先读 /llms.txt，从里面拿当前有效的目录地址。
 *    原因：Shopify 会把 /pages/* 的整个响应按 User-Agent 冻结缓存，站点侧靠"内容变了就换一个
 *    没被访问过的路径"来保鲜，而 /llms.txt 不走那套缓存、永远是新的。
 *    ⇒ 写死目录路径的客户端迟早会读到一份过期快照；跟着 llms.txt 走就不会。
 */

export const SITE = "https://agentskill.nz";
const LLMS_URL = `${SITE}/llms.txt`;
/** llms.txt 读不到时的兜底，只是让工具还能用，不是首选 */
const FALLBACK_CATALOG = `${SITE}/pages/catalog`;
const TTL_MS = 10 * 60 * 1000;

export interface Capability {
  id: string;
  name: string;
  module: string;
  form: string;
  outcome: string;
  url: string;
  tier: "free" | "paid";
  price: { amount: number; currency: string };
  version?: string;
  package_size?: string;
  updated?: string;
  repository?: string;
  source?: string;
  github_stars?: number;
  install?: string;
  download?: string | null;
  purchase_url?: string;
}

export interface Catalog {
  schema_version: string;
  name: string;
  url: string;
  description?: string;
  positioning?: string;
  generated_at?: string;
  language?: string;
  counts: { total: number; free: number; paid: number };
  forms?: Record<string, string>;
  usage?: Record<string, string>;
  modules: Array<{ handle: string | null; title: string | null; count: number; url: string | null }>;
  capabilities: Capability[];
}

let cache: { at: number; data: Catalog } | null = null;

/**
 * 🔴 中英合并搜索索引：id -> 该能力在**两种语言**下的全部可搜文本。
 *    llms.txt 公布的是英文目录，所以不做这一步的话，中文查询（"A股"、"去水印"）一条都命中不了 ——
 *    而中文正是相当一部分用户会打的词。目录自带 alternate_language_url，顺着它再取一份即可。
 */
let searchIndex: Map<string, string> = new Map();
/** id -> 另一语言的名称，用于结果里一并显示 */
let altNames: Map<string, string> = new Map();

async function discoverCatalogUrl(): Promise<string> {
  try {
    const res = await fetch(LLMS_URL, { headers: { "user-agent": UA } });
    if (!res.ok) return FALLBACK_CATALOG;
    const text = await res.text();
    // llms.txt 里的形式是:  GET https://agentskill.nz/pages/<handle>
    const m = text.match(/GET\s+(https?:\/\/[^\s`]+\/pages\/[A-Za-z0-9_-]+)/);
    return m ? m[1] : FALLBACK_CATALOG;
  } catch {
    return FALLBACK_CATALOG;
  }
}

const UA = "agentskill-mcp (+https://github.com/simonlin1212/agentskill-mcp)";

export async function getCatalog(force = false): Promise<Catalog> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.data;

  const url = await discoverCatalogUrl();
  // ⚠️ 绝不要发 `Accept: application/json`：那个精确值会让 Shopify 回一个页面元数据对象，
  //    而不是目录正文。`*/*` 正常。（2026-08-18 实测）
  const res = await fetch(url, { headers: { accept: "*/*", "user-agent": UA } });
  if (!res.ok) throw new Error(`目录取不到（${url} 返回 ${res.status}）`);

  const data = (await res.json()) as Catalog;
  if (!data || typeof data !== "object" || !Array.isArray(data.capabilities)) {
    throw new Error(`目录格式不对：${url} 没有返回带 capabilities 的 JSON`);
  }
  cache = { at: Date.now(), data };
  await buildSearchIndex(data);
  return data;
}

const searchText = (c: Capability) =>
  [c.id, c.name, c.outcome, c.repository, c.module, c.form].filter(Boolean).join(" ").toLowerCase();

async function buildSearchIndex(primary: Catalog): Promise<void> {
  searchIndex = new Map(primary.capabilities.map((c) => [c.id.toLowerCase(), searchText(c)]));
  altNames = new Map();
  const altUrl = (primary as any).alternate_language_url as string | undefined;
  if (!altUrl) return;
  try {
    const r = await fetch(altUrl, { headers: { accept: "*/*", "user-agent": UA } });
    if (!r.ok) return;                       // 拿不到就退回单语搜索，不让它阻断主流程
    const alt = (await r.json()) as Catalog;
    if (!Array.isArray(alt?.capabilities)) return;
    for (const c of alt.capabilities) {
      const k = c.id.toLowerCase();
      searchIndex.set(k, ((searchIndex.get(k) ?? "") + " " + searchText(c)).trim());
      if (c.name) altNames.set(k, c.name);
    }
  } catch { /* 另一语言只是加分项，失败不该让搜索不可用 */ }
}

export function altName(id: string): string | undefined {
  return altNames.get(id.toLowerCase());
}

/**
 * 关键词命中：名称、说明、仓库名、模块、形态，**中英两种语言都算**。
 *
 * 🔴 中文必须再做一次「去空格」匹配。中文目录里写的是「A 股全栈数据」（A 与股之间有空格，
 *    那是排版习惯），而用户打的是「A股」—— 只按空白分词的话，这一条永远命中不了，
 *    而它恰好是店里最热门的能力。所以：先按词匹配，不中再把两边空格全抹掉整串包含一次。
 */
export function matches(c: Capability, q: string): boolean {
  const hay = searchIndex.get(c.id.toLowerCase()) ?? searchText(c);
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length && words.every((w) => hay.includes(w))) return true;
  const squash = (s: string) => s.toLowerCase().replace(/\s+/g, "");
  return squash(q).length > 0 && squash(hay).includes(squash(q));
}

export function fmtPrice(c: Capability): string {
  return c.tier === "free" ? "free" : `${c.price.currency} ${c.price.amount.toFixed(2)}`;
}
