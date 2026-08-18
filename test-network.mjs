/**
 * 网络行为测试：字节上限、重定向策略、共享 deadline、失败退避、并发单飞。
 *
 * 🔴 用 mock globalThis.fetch，**不放宽任何生产安全属性**。
 *    我一度想用本地 http server 来测，那需要允许 http+localhost —— 而拒绝非同源、非 https
 *    正是这里最该守住的东西。为了可测性去削弱它是本末倒置；打桩 fetch 一样测得到。
 */
import { getCatalog, __resetForTests } from "./dist/catalog.js";

let failed = 0;
const bad = (m) => { console.error("  🔴 " + m); failed++; };
const ok = (m) => console.log("  ✅ " + m);

const LLMS = "https://agentskill.nz/llms.txt";
const CAT = "https://agentskill.nz/pages/catalog";
const body = (o) => JSON.stringify(o);
const MIN_CATALOG = {
  schema_version: "1.0", name: "AgentSkill", url: "https://agentskill.nz",
  counts: { total: 1, free: 1, paid: 0 }, modules: [{ handle: "general", title: "General", count: 1, url: null }],
  capabilities: [{ id: "x", name: "X", module: "General", form: "Install Skill", outcome: "o",
                   url: "https://agentskill.nz/products/x", tier: "free",
                   price: { amount: 0, currency: "USD" }, download: "https://cdn.shopify.com/x.zip" }],
};
const res = (bodyStr, init = {}) => new Response(bodyStr, { status: 200, ...init });
const llmsText = `GET ${CAT}\n`;

let calls = [];
const install = (handler) => {
  calls = [];
  globalThis.fetch = async (url, opts) => { calls.push(String(url)); return handler(String(url), opts); };
};
const expectThrow = async (label) => {
  try { await getCatalog(true); bad(`${label}：本该抛错却成功了`); }
  catch { ok(label); }
};

// 1. 超过字节上限要中止
__resetForTests();
install((u) => {
  if (u === LLMS) return res(llmsText);
  const chunk = new Uint8Array(1024 * 256).fill(65);
  return new Response(new ReadableStream({
    pull(c) { c.enqueue(chunk); },       // 无限流：不设上限就会一直吃内存
  }), { status: 200 });
});
await expectThrow("超过 4MB 上限时中止读取");

// 2. 跨站重定向必须拒绝
__resetForTests();
install((u) => u === LLMS ? res(llmsText)
  : new Response(null, { status: 302, headers: { location: "https://evil.example/steal" } }));
await expectThrow("拒绝跨站重定向");

// 3. 同站重定向要跟随
__resetForTests();
let hop = 0;
install((u) => {
  if (u === LLMS) return res(llmsText);
  if (u === CAT && hop++ === 0) return new Response(null, { status: 302, headers: { location: "/pages/catalog-new" } });
  return res(body(MIN_CATALOG));
});
try { const c = await getCatalog(true); ok(`跟随同站重定向（拿到 ${c.counts.total} 条）`); }
catch (e) { bad("同站重定向被误拒: " + e.message); }

// 4. 重定向次数超限要停
__resetForTests();
install((u) => u === LLMS ? res(llmsText)
  : new Response(null, { status: 302, headers: { location: "/pages/loop" } }));
await expectThrow("重定向超过上限时停止");

// 5. 并发只打一次网络（单飞）
__resetForTests();
install((u) => u === LLMS ? res(llmsText) : res(body(MIN_CATALOG)));
await Promise.all([getCatalog(), getCatalog(), getCatalog()]);
const catFetches = calls.filter((u) => u === CAT).length;
if (catFetches !== 1) bad(`并发 3 次调用打了 ${catFetches} 次目录请求，单飞没生效`);
else ok("并发调用共享同一次刷新");

// 6. 失败后有旧快照就退避，不再打网络
install((u) => u === LLMS ? res(llmsText) : res(body(MIN_CATALOG)));
await getCatalog(true);                       // 先存一份好快照
install(() => { throw new Error("网络挂了"); });
try { await getCatalog(true); } catch { /* force 会真去打 */ }
const before = calls.length;
await getCatalog();                            // 非 force：应命中退避
if (calls.length !== before) bad("失败退避没生效，仍在打网络");
else ok("刷新失败后退避，直接用旧快照");

if (failed) { console.error(`\n🔴 ${failed} 项未通过`); process.exit(1); }
console.log("\n🎉 网络行为测试全过");
