/**
 * 冒烟测试：用真实 MCP stdio 协议打一遍服务器。**编译通过 ≠ 能用。**
 *
 * 它守三件事：
 *   1. 协议层活着（initialize / tools/list / tools/call）
 *   2. stdout 只有 JSON-RPC —— 任何一行杂音都直接判失败（stdio 传输下那就是协议损坏）
 *   3. 硬规则：**任何付费能力、经任何一个工具、都不会返回可下载的文件地址**
 */
import { spawn } from "node:child_process";

const child = spawn("node", ["dist/index.js"], { stdio: ["pipe", "pipe", "pipe"] });
let buf = "";
const pending = new Map();
let stdoutViolation = null;

child.stdout.on("data", (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const raw = buf.slice(0, i); buf = buf.slice(i + 1);
    if (!raw.trim()) continue;
    let msg;
    try { msg = JSON.parse(raw); }
    catch {
      // 🔴 不能 silently continue —— 那样服务器打了 banner/日志到 stdout 也照样"测试通过"，
      //    而这正是 stdio MCP 最典型的破坏方式。记下来，最后判失败。
      stdoutViolation ??= raw.slice(0, 200);
      continue;
    }
    if (msg.jsonrpc !== "2.0") stdoutViolation ??= `非 JSON-RPC 帧: ${raw.slice(0, 120)}`;
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  }
});
child.stderr.on("data", (d) => process.stderr.write("[stderr] " + d));

let id = 0;
const timers = new Set();
const send = (method, params) => new Promise((res, rej) => {
  const myId = ++id;
  const t = setTimeout(() => { pending.delete(myId); rej(new Error(`${method} 超时`)); }, 25000);
  timers.add(t);
  pending.set(myId, (m) => { clearTimeout(t); timers.delete(t); res(m); });
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: myId, method, params }) + "\n");
});
const notify = (m, p) => child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: m, params: p }) + "\n");
const call = async (name, args) => {
  const r = await send("tools/call", { name, arguments: args });
  if (r.error) fail(`${name}: ${JSON.stringify(r.error)}`);
  return r.result.content.map((c) => c.text ?? "").join("\n");
};

const fail = (m) => { console.error("🔴 " + m); for (const t of timers) clearTimeout(t); child.kill(); process.exit(1); };
child.on("error", (e) => fail("子进程错误: " + e.message));
child.on("exit", (code) => { if (code !== null && code !== 0) fail(`服务器提前退出，code=${code}`); });

/** 与 src/index.ts 的守卫同源 —— 测试端独立再判一次，别只信服务端自己检查过 */
const FILE_URL = /https?:\/\/\S+\.(zip|tar|tar\.gz|tgz|gz|7z|rar|dmg|pkg|exe|msi|whl|jar)(\?\S*)?/i;
const CDN_HOST = /https?:\/\/[^\s/]*cdn\.shopify\.com\S*/i;

try {
  const init = await send("initialize", {
    protocolVersion: "2026-07-28", capabilities: {}, clientInfo: { name: "smoke", version: "1.0" },
  });
  if (init.error) fail("initialize: " + JSON.stringify(init.error));
  console.log("✅ initialize —", init.result.serverInfo.name, init.result.serverInfo.version,
              "| protocol", init.result.protocolVersion);
  notify("notifications/initialized", {});

  const list = await send("tools/list", {});
  if (list.error) fail("tools/list: " + JSON.stringify(list.error));
  const tools = list.result.tools;
  console.log(`✅ tools/list — ${tools.length} 个:`, tools.map((t) => t.name).join(", "));
  for (const t of tools) if (!t.description || !t.inputSchema) fail(`工具 ${t.name} 缺 description 或 inputSchema`);

  // 中文与英文查询都要命中
  for (const [q, want] of [["A股", "a-stock-data"], ["去水印", "image-repair"], ["remove watermark", "image-repair"]]) {
    const out = await call("search_capabilities", { query: q, limit: 5 });
    if (!out.includes(want)) fail(`查询「${q}」没有命中 ${want}`);
  }
  console.log("✅ 中英文查询命中（A股 / 去水印 / remove watermark）");

  // 🔴 每个合法的 module 取值都必须真能筛出东西 —— 上一版有一半静默返回空
  const modules = tools.find((t) => t.name === "search_capabilities").inputSchema.properties.module.enum;
  for (const m of modules) {
    const out = await call("search_capabilities", { module: m, limit: 50 });
    if (/^No capability matched/.test(out)) fail(`module="${m}" 返回空 —— 别名映射又断了`);
  }
  console.log(`✅ ${modules.length} 个 module 取值全部筛得到结果`);

  // 🔴 硬规则：遍历**所有**付费能力，过**每一个**输出路径
  const all = await call("search_capabilities", { tier: "paid", limit: 50 });
  if (FILE_URL.test(all) || CDN_HOST.test(all)) fail("search_capabilities(tier=paid) 输出里出现了文件地址");
  const paidIds = [...all.matchAll(/\[([a-z0-9-]+)\]/g)].map((m) => m[1]);
  if (paidIds.length < 5) fail(`只解析到 ${paidIds.length} 个付费能力，测试覆盖不足`);
  for (const pid of paidIds) {
    const d = await call("get_capability", { id: pid });
    if (FILE_URL.test(d) || CDN_HOST.test(d)) fail(`付费能力 ${pid} 的详情里出现了文件地址`);
  }
  console.log(`✅ ${paidIds.length} 个付费能力 × 2 条输出路径，零文件地址`);

  // 免费的反过来必须真的给得出下载地址，否则这个工具就没用了
  const freeOut = await call("search_capabilities", { tier: "free", limit: 5 });
  if (!CDN_HOST.test(freeOut)) fail("免费能力没有给出下载地址");
  console.log("✅ 免费能力给得出下载地址");

  const bad = await call("get_capability", { id: "no-such-thing" });
  if (!/No capability/i.test(bad)) fail("未知 id 没有给出可读的提示");
  console.log("✅ 未知 id 有可读提示");

  const mods = await call("list_modules", {});
  if (!/capabilities/.test(mods)) fail("list_modules 输出异常");
  console.log("✅ list_modules 正常");

  // 🔴 现代协议（2026-07-28）必须真的握得上手，不能只因为用了 serveStdio 就假定它在。
  //    上面那次 initialize 走的是 2025 那一族（`initialize` 本身就是 legacy 开场），
  //    现代那族没有 initialize：靠 server/discover + 每条请求带 _meta envelope。
  //    这一段是独立进程，因为一条连接的时代在开场那一刻就被钉死了。
  const modern = await new Promise((resolve) => {
    const c2 = spawn("node", ["dist/index.js"], { stdio: ["pipe", "pipe", "pipe"] });
    let b = "", done = false;
    const finish = (v) => { if (!done) { done = true; c2.kill(); resolve(v); } };
    c2.stdout.on("data", (d) => {
      b += d; let i;
      while ((i = b.indexOf("\n")) >= 0) {
        const r = b.slice(0, i); b = b.slice(i + 1);
        if (r.trim()) { try { finish(JSON.parse(r)); } catch { /* 等完整帧 */ } }
      }
    });
    c2.stdin.write(JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "server/discover",
      params: { _meta: {
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientCapabilities": {},
      } },
    }) + "\n");
    setTimeout(() => finish(null), 15000);
  });
  if (!modern?.result?.supportedVersions?.includes("2026-07-28")) {
    fail(`现代协议握手失败：${JSON.stringify(modern)?.slice(0, 200)}`);
  }
  if (!modern.result.capabilities?.tools) fail("现代握手没有广告 tools capability");
  console.log(`✅ 现代协议握手 — supportedVersions ${modern.result.supportedVersions.join(", ")}`);

  if (stdoutViolation) fail(`stdout 出现非 JSON-RPC 内容（stdio 下即协议损坏）: ${stdoutViolation}`);
  console.log("✅ stdout 全程只有 JSON-RPC");

  console.log("\n🎉 冒烟测试全过");
  for (const t of timers) clearTimeout(t);
  child.kill(); process.exit(0);
} catch (e) { fail(e.message); }
