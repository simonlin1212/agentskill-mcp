/**
 * 取 agentskill.nz 的机器目录。
 *
 * 🔴 目录 URL 是**发现出来的，不是写死的**：先读 /llms.txt，从里面拿当前有效的目录地址。
 *    原因：Shopify 会把 /pages/* 的整个响应按 User-Agent 冻结缓存，站点侧靠"内容变了就换一个
 *    没被访问过的路径"来保鲜，而 /llms.txt 不走那套缓存、永远是新的。
 *    ⇒ 写死目录路径的客户端迟早会读到一份过期快照；跟着 llms.txt 走就不会。
 *
 * 🔴 但"地址来自远程"意味着**远程能指挥这个进程去请求任意地址**，而这份代码跑在别人的机器上。
 *    所以每一个 URL 都必须先过 sameOrigin()，重定向也要逐跳校验 —— 否则一份被改动的目录
 *    就能让所有装了它的 agent 去打内网或云元数据服务。
 */

import { assertPaidSafe } from "./guard.js";

export const SITE = "https://agentskill.nz";
const SITE_ORIGIN = new URL(SITE).origin;
const LLMS_URL = `${SITE}/llms.txt`;
/** llms.txt 读不到时的兜底，只是让工具还能用，不是首选 */
const FALLBACK_CATALOG = `${SITE}/pages/catalog`;

/**
 * 缓存 5 分钟。
 * ⚠️ 审计建议过"返回 download 前重新拉一次确认它还免费"，这里**没有采纳**：
 *    免费包的 download 是 Shopify Files 的**公开 CDN 地址**，任何人无需鉴权即可下载。
 *    就算某天该商品改成付费，那个旧 ZIP 在 CDN 上依然是公开的 —— 少给一次地址并不能
 *    把它变回私密，却会让每次工具调用都多一轮网络往返。真正要守的是**付费项从不产生
 *    新的文件地址**，那条在输出边界强制（见 index.ts 的 assertNoFileUrl）。
 */
const TTL_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8_000;
const ALT_TIMEOUT_MS = 5_000;
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_REDIRECTS = 3;

const UA = "agentskill-mcp (+https://github.com/simonlin1212/agentskill-mcp)";

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
  alternate_language_url?: string;
  counts: { total: number; free: number; paid: number };
  forms?: Record<string, string>;
  usage?: Record<string, string>;
  modules: Array<{ handle: string | null; title: string | null; count: number; url: string | null }>;
  capabilities: Capability[];
}

/**
 * 🔴 付费记录在**入库时**就净化，不留到输出时才拦。
 *
 * 两个教训（复审挖出来的）：
 *   1. `tier` 来自远程且只做过类型断言。`"Paid"` / `"premium"` / 缺失 都不等于 `"free"`，
 *      却也不等于 `"paid"` —— 只认精确 `"paid"` 的守卫会把它们全放过去。
 *      ⇒ **fail closed：不是 `"free"` 的一律按付费对待。**
 *   2. 靠文件扩展名认"下载地址"做不成硬规则：`/download?id=123`、签名端点、对象存储直链
 *      都没有扩展名。⇒ 付费记录里**只保留白名单里的两个本站 URL**（商品页、结账页），
 *      其余自由文本中出现的任何 http(s) 地址一律剥除。
 *
 * 坏记录**就地净化，不抛异常** —— 一条记录有问题不该让整页搜索失败。
 */
const URL_IN_TEXT = /https?:\/\/\S+/gi;

function stripUrls(v: string | undefined): string | undefined {
  if (!v) return v;
  return v.replace(URL_IN_TEXT, "[link removed]").trim();
}

/**
 * 付费项允许出现的 URL：只有本站的商品/集合/页面/购物车/账户路径。
 * 判定复用 guard.ts 的同一个函数 —— 两处各写一套迟早会分叉，而分叉的那一侧就是缺口。
 */
function keepIfOwnPage(u: string | undefined): string | undefined {
  if (!u) return undefined;
  const parsed = sameOrigin(u);
  if (!parsed) return undefined;
  try { assertPaidSafe(parsed.toString(), "normalize"); } catch { return undefined; }
  return parsed.toString();
}

export function normalizeCapability(raw: Capability): Capability {
  // fail closed：只有明确写着 free 才算免费
  const isFree = raw.tier === "free";
  if (isFree) return raw;
  return {
    ...raw,
    tier: "paid",
    download: null,
    name: stripUrls(raw.name) ?? raw.id,
    outcome: stripUrls(raw.outcome) ?? "",
    install: stripUrls(raw.install),
    source: stripUrls(raw.source),
    repository: stripUrls(raw.repository),
    url: keepIfOwnPage(raw.url) ?? SITE,
    purchase_url: keepIfOwnPage(raw.purchase_url),
  };
}

/** 一次刷新的完整产物。**整体替换**，绝不逐字段更新 —— 否则并发刷新会互相看到半成品。 */
interface Snapshot {
  at: number;
  data: Catalog;
  /** id -> 中英合并后的可搜文本 */
  searchIndex: Map<string, string>;
  /** id -> 另一语言的名称 */
  altNames: Map<string, string>;
}

let snapshot: Snapshot | null = null;
/** 同一时刻只允许一次刷新在飞，避免并发各拉一份、还互相覆盖索引 */
let inFlight: Promise<Snapshot> | null = null;
/** 上次刷新失败的时刻。站点挂掉时，别让每一次工具调用都重新吃满超时。 */
let lastFailAt = 0;
const FAIL_BACKOFF_MS = 30_000;

/** 只允许本站的 https 地址。远程可以决定"路径"，但决定不了"去哪台机器"。 */
function sameOrigin(raw: string): URL | null {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== "https:") return null;
  if (u.origin !== SITE_ORIGIN) return null;
  return u;
}

/**
 * 带超时、逐跳校验重定向、限制体积的取回。
 *
 * redirect 用 manual：若交给 fetch 自动跟随，跨站那一跳**已经发出去了**，事后再检查 response.url
 * 只能发现、不能阻止。
 *
 * 🔴 两处是复审纠正过来的，注意别改回去：
 *   · **一个 deadline 管整条链**，不是每跳一个。每跳各给 8 秒的话，4 跳就是 32 秒 ——
 *     那和注释里承诺的"8 秒超时"不是一回事。
 *   · **边读边数字节**，不能先 `res.text()` 再判长度：那时整个响应已经在内存里了，
 *     防不住内存耗尽；而且 `.length` 数的是 UTF-16 字符，不是收到的字节。
 */
async function fetchChecked(rawUrl: string, timeoutMs: number): Promise<string> {
  let target = sameOrigin(rawUrl);
  if (!target) throw new Error(`拒绝请求非本站地址：${rawUrl}`);

  const ac = new AbortController();
  const deadline = setTimeout(() => ac.abort(new Error("整体超时")), timeoutMs);
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const res = await fetch(target.toString(), {
        headers: { accept: "*/*", "user-agent": UA },
        redirect: "manual",
        signal: ac.signal,
      });

      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) throw new Error(`${target} 返回 ${res.status} 但没有 Location`);
        const next = sameOrigin(new URL(loc, target).toString());
        if (!next) throw new Error(`拒绝跟随跨站重定向：${loc}`);
        await res.body?.cancel();
        target = next;
        continue;
      }
      if (!res.ok) throw new Error(`${target} 返回 ${res.status}`);
      if (!res.body) return "";

      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_BYTES) {
          await reader.cancel();
          throw new Error(`响应超过 ${MAX_BYTES} 字节上限`);
        }
        chunks.push(value);
      }
      const buf = new Uint8Array(total);
      let off = 0;
      for (const c of chunks) { buf.set(c, off); off += c.byteLength; }
      return new TextDecoder().decode(buf);
    }
    throw new Error(`重定向次数超过 ${MAX_REDIRECTS} 跳`);
  } finally {
    clearTimeout(deadline);
  }
}

async function discoverCatalogUrl(): Promise<string> {
  try {
    const text = await fetchChecked(LLMS_URL, FETCH_TIMEOUT_MS);
    // llms.txt 里的形式是:  GET https://agentskill.nz/pages/<handle>
    const m = text.match(/GET\s+(https:\/\/[^\s`]+\/pages\/[A-Za-z0-9_-]+)/);
    if (!m) return FALLBACK_CATALOG;
    return sameOrigin(m[1]) ? m[1] : FALLBACK_CATALOG;
  } catch {
    return FALLBACK_CATALOG;
  }
}

const searchText = (c: Capability) =>
  [c.id, c.name, c.outcome, c.repository, c.module, c.form].filter(Boolean).join(" ").toLowerCase();

async function refresh(): Promise<Snapshot> {
  const url = await discoverCatalogUrl();
  // ⚠️ 绝不要发 `Accept: application/json`：那个精确值会让 Shopify 回一个页面元数据对象，
  //    而不是目录正文。fetchChecked 用的是 `*/*`。（2026-08-18 实测）
  const raw = await fetchChecked(url, FETCH_TIMEOUT_MS);

  let data: Catalog;
  try { data = JSON.parse(raw) as Catalog; }
  catch { throw new Error(`目录不是合法 JSON（${url}）`); }
  if (!data || typeof data !== "object" || !Array.isArray(data.capabilities)) {
    throw new Error(`目录格式不对：${url} 没有返回带 capabilities 的 JSON`);
  }
  // 丢掉结构上就不能用的记录（没 id / 没 name），其余按 fail-closed 归一化
  data.capabilities = data.capabilities
    .filter((c) => c && typeof c.id === "string" && c.id.trim() && typeof c.name === "string" && c.name.trim())
    .map(normalizeCapability);

  // 🔴 counts 和 modules[].count 是远程原值，而我们刚刚过滤掉了坏记录、也改过 tier ——
  //    直接沿用会让报出来的数字和自己手里的记录对不上。按归一化后的实际情况重算。
  const freeN = data.capabilities.filter((c) => c.tier === "free").length;
  data.counts = { total: data.capabilities.length, free: freeN, paid: data.capabilities.length - freeN };
  // 按模块计数：用 handle 对齐（title 会随语言变，handle 不会）。
  // 🔴 对不上就记 0，绝不沿用远程原值 —— 那正是"数字和自己手里的记录对不上"的来源。
  const norm = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();
  const TITLE_TO_HANDLE: Record<string, string> = {
    finance: "finance", 金融: "finance",
    commerce: "ecommerce", ecommerce: "ecommerce", 电商: "ecommerce",
    creator: "media", media: "media", 自媒体: "media",
    general: "general", 通用: "general",
  };
  const perModule = new Map<string, number>();
  for (const c of data.capabilities) {
    const h = TITLE_TO_HANDLE[norm(c.module)] ?? norm(c.module);
    perModule.set(h, (perModule.get(h) ?? 0) + 1);
  }
  data.modules = (data.modules ?? []).map((m) => {
    const h = norm(m.handle) || TITLE_TO_HANDLE[norm(m.title)] || norm(m.title);
    return { ...m, count: perModule.get(h) ?? 0 };
  });

  // 索引先在局部变量里建好，最后随 snapshot 一起原子发布
  const searchIndex = new Map(data.capabilities.map((c) => [c.id.toLowerCase(), searchText(c)]));
  const altNames = new Map<string, string>();

  // 另一语言是加分项：拿不到就退回单语搜索，绝不阻断主流程
  if (data.alternate_language_url && sameOrigin(data.alternate_language_url)) {
    try {
      const altRaw = await fetchChecked(data.alternate_language_url, ALT_TIMEOUT_MS);
      const alt = JSON.parse(altRaw) as Catalog;
      if (Array.isArray(alt?.capabilities)) {
        // 🔴 副目录（另一语言）同样是远程数据，必须走一遍 normalizeCapability 再用。
        //    上一版直接把它的 name 填进 altNames —— 一个带外域链接的中文名就能让
        //    付费项的输出被守卫拒绝，整条工具调用失败。净化在入库这一侧做，输出侧才不会炸。
        const primaryTier = new Map(data.capabilities.map((c) => [c.id.toLowerCase(), c.tier]));
        for (const raw of alt.capabilities) {
          if (!raw || typeof raw.id !== "string" || !raw.id.trim()) continue;
          if (typeof raw.name !== "string" || !raw.name.trim()) continue;
          // 🔴 tier 以**主目录**为准。副目录自己声称的 tier 不能信：主记录是 paid、
          //    副记录写 free 的话，副语言的名字就绕过了付费净化。
          const authoritative = primaryTier.get(raw.id.trim().toLowerCase()) ?? "paid";
          const c = normalizeCapability({ ...raw, tier: authoritative });
          const k = c.id.toLowerCase();
          searchIndex.set(k, ((searchIndex.get(k) ?? "") + " " + searchText(c)).trim());
          altNames.set(k, c.name);
        }
      }
    } catch { /* 单语可用即可 */ }
  }

  return { at: Date.now(), data, searchIndex, altNames };
}

export async function getCatalog(force = false): Promise<Catalog> {
  return (await getSnapshot(force)).data;
}

async function getSnapshot(force = false): Promise<Snapshot> {
  if (!force && snapshot && Date.now() - snapshot.at < TTL_MS) return snapshot;
  // 刚失败过就先用旧快照顶着 —— 否则站点一挂，每次调用都要空等一整个超时
  if (!force && snapshot && Date.now() - lastFailAt < FAIL_BACKOFF_MS) return snapshot;
  // 已有刷新在飞就搭它的车 —— 不要各拉各的，那正是索引互相覆盖的来源
  if (!inFlight) {
    inFlight = refresh()
      .then((s) => { snapshot = s; return s; })
      .finally(() => { inFlight = null; });
  }
  try {
    return await inFlight;
  } catch (e) {
    lastFailAt = Date.now();
    // 刷新失败时，宁可用上一份快照也别让工具整个不可用；一份都没有才抛
    if (snapshot) return snapshot;
    throw e;
  }
}

/** 另一语言的名称，用于结果里一并显示 */
export function altName(id: string): string | undefined {
  return snapshot?.altNames.get(id.toLowerCase());
}

/**
 * 关键词命中：名称、说明、仓库名、模块、形态，**中英两种语言都算**。
 *
 * 🔴 中文必须再做一次「去空格」匹配。中文目录里写的是「A 股全栈数据」（A 与股之间有空格，
 *    那是排版习惯），而用户打的是「A股」—— 只按空白分词的话，这一条永远命中不了，
 *    而它恰好是店里最热门的能力。所以：先按词匹配，不中再把两边空格全抹掉整串包含一次。
 */
export function matches(c: Capability, q: string): boolean {
  const hay = snapshot?.searchIndex.get(c.id.toLowerCase()) ?? searchText(c);
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length && words.every((w) => hay.includes(w))) return true;
  const squash = (s: string) => s.toLowerCase().replace(/\s+/g, "");
  return squash(q).length > 0 && squash(hay).includes(squash(q));
}

/** 仅供测试：清掉模块级状态。ESM 模块只会被求值一次，不给个重置口就没法测退避和并发。 */
export function __resetForTests(): void {
  snapshot = null; inFlight = null; lastFailAt = 0;
}

export function fmtPrice(c: Capability): string {
  return c.tier === "free" ? "free" : `${c.price.currency} ${c.price.amount.toFixed(2)}`;
}
