/** 冒烟测试：用真实 MCP stdio 协议打一遍服务器。编译通过 ≠ 能用。 */
import { spawn } from "node:child_process";

const child = spawn("node", ["dist/index.js"], { stdio: ["pipe", "pipe", "pipe"] });
let buf = "";
const pending = new Map();
child.stdout.on("data", (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const raw = buf.slice(0, i); buf = buf.slice(i + 1);
    if (!raw.trim()) continue;
    let msg; try { msg = JSON.parse(raw); } catch { continue; }
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  }
});
child.stderr.on("data", (d) => process.stderr.write("[stderr] " + d));

let id = 0;
const send = (method, params) => new Promise((res, rej) => {
  const myId = ++id;
  pending.set(myId, res);
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: myId, method, params }) + "\n");
  setTimeout(() => rej(new Error(`${method} 超时`)), 25000);
});
const notify = (method, params) =>
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");

const fail = (m) => { console.error("🔴 " + m); child.kill(); process.exit(1); };

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
  for (const t of tools) {
    if (!t.description || !t.inputSchema) fail(`工具 ${t.name} 缺 description 或 inputSchema`);
  }

  const s = await send("tools/call", { name: "search_capabilities", arguments: { query: "A股", limit: 2 } });
  if (s.error) fail("search: " + JSON.stringify(s.error));
  const st = s.result.content[0].text;
  console.log("✅ search_capabilities（中文查询）:\n" + st.split("\n").slice(0, 6).map((l) => "     " + l).join("\n"));

  const g = await send("tools/call", { name: "get_capability", arguments: { id: "codex-audit" } });
  if (g.error) fail("get: " + JSON.stringify(g.error));
  const gt = g.result.content[0].text;
  console.log("✅ get_capability(codex-audit) 前 6 行:\n" + gt.split("\n").slice(0, 6).map((l) => "     " + l).join("\n"));
  // 🔴 铁律：付费项绝不能返回文件地址
  if (/cdn\.shopify|\.zip/.test(gt)) fail("付费能力泄露了下载直链！");
  console.log("✅ 付费项零下载直链");

  const m = await send("tools/call", { name: "list_modules", arguments: {} });
  if (m.error) fail("modules: " + JSON.stringify(m.error));
  console.log("✅ list_modules 前 4 行:\n" + m.result.content[0].text.split("\n").slice(0, 4).map((l) => "     " + l).join("\n"));

  const bad = await send("tools/call", { name: "get_capability", arguments: { id: "no-such-thing" } });
  const bt = bad.result?.content?.[0]?.text ?? "";
  if (!/No capability/i.test(bt)) fail("未知 id 没有给出可读的提示");
  console.log("✅ 未知 id 有可读提示");

  console.log("\n🎉 冒烟测试全过");
  child.kill(); process.exit(0);
} catch (e) { fail(e.message); }
