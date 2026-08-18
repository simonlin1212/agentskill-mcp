/**
 * 付费输出的守卫。单独成文件是为了**能被测试直接 import** ——
 * 放在 index.ts 里就只能连着启动整个服务器才测得到，那样对抗性用例根本没法写。
 */

export const SITE = "https://agentskill.nz";
const SITE_ORIGIN = new URL(SITE).origin;

/**
 * 🔴 白名单匹配的是**完整路由形状**，不是前缀。
 *
 *    两次收紧的来历：
 *    ① 最早只排文件后缀 —— 同源的 `/download?id=123`、`/files/abc`、签名端点全都没后缀，照样过。
 *    ② 改成前缀白名单后仍然过宽：`/products/x/download`、`/account/files/secret`、
 *       `/pages/catalog/export` 都还是"以允许的前缀开头"。
 *    ⇒ 现在每一类都锁死到商店真实存在的那一种形状，多一段路径就不认。
 *
 *    不加 `/i`：URL 路径是大小写敏感的，接受大写变体等于白白放宽边界。
 *    新增路径类型必须显式加进来 —— 加不进来，就说明它不该出现在付费项的输出里。
 */
const SLUG = "[A-Za-z0-9][A-Za-z0-9._-]*";
const ALLOWED_PATH = new RegExp(
  "^/(?:zh/?)?$" +                                   // 站点根，以及 /zh、/zh/
  "|^/(?:zh/)?products/" + SLUG + "/?$" +            // 商品页
  "|^/(?:zh/)?collections/" + SLUG + "/?$" +         // 模块（集合）页
  "|^/(?:zh/)?pages/" + SLUG + "/?$" +               // 普通页面，含机器目录
  "|^/(?:zh/)?cart(?:/\\d+:\\d+)?/?$"            // 购物车 / 直达结账
);

/**
 * 🔴 **不靠文件扩展名认下载地址** —— `/download?id=123`、签名端点、对象存储直链都没有扩展名。
 *    反过来做白名单：付费能力的输出里允许出现的 http(s) 地址，只有本站的页面地址。
 */
/**
 * 🔴 **不用正则去"找 URL"，改成让 URL 解析器判断。**
 *
 *    用正则找的话，边缘形式可以一直冒出来，每补一个又漏下一个：
 *      `//evil.example/x`（没有 scheme）· `https:/\evil.example/x`（反斜杠，解析器当 `//` 用）·
 *      `https://user@evil.example/x`（userinfo 骗过肉眼）· `HTTPS://EVIL...`（大小写）·
 *      同形字域名（西里尔字母的 а）。
 *    而 `new URL()` 对这些**全部给出正确的 origin**（同形字还会 punycode 化成
 *    `xn--gentskill-zyh.nz`，自然对不上）。⇒ 只负责把文本切成候选片段，判断交给解析器。
 *
 *    切分只用**不可能出现在 URL 里**的字符：空白、右括号方括号、引号、尖括号。
 *    逗号和分号不切 —— 它们是合法路径字符（RFC 3986 sub-delims），当分隔符会把
 *    `/products/x;download` 截成 `/products/x` 而放行。
 */
/**
 * 切分用的字符集必须**成对齐全**：只写 `)` `]` 不写 `(` `[` 的话，`(https://evil.example/x)`
 * 切出来的 token 以 `(` 开头，既不是 scheme 开头也不是 `//` 开头，于是被整个跳过。
 * 实测被这一个字符绕过过。
 */
const SEPARATORS = /[\s()[\]{}"'`<>|]+/;

/**
 * ⚖️ **明确不管的一类：裸主机名**（`evil.example/x`，既没有 scheme 也没有 `//`）。
 *
 *    这是审计里唯一一条我没有采纳的意见，理由是实测出来的：
 *    拦它必须把"看起来像域名的文本"都当地址，而 `.md` 是有效 TLD（摩尔多瓦），于是
 *    **`SKILL.md` / `GOTCHAS.md` / `WORKFLOW.md` 全部会被判成域名** —— 那正是付费包
 *    交付清单和安装命令里的真实内容，等于每一条付费详情都被自己的守卫拒掉。
 *
 *    威胁模型上也不划算：这些输出是给 agent 读的**纯文本**，裸主机名只有在渲染器主动
 *    linkify 时才成为可点地址；而能改动商品数据的攻击者直接写完整 URL 更省事 —— 那条路已经堵死。
 *    ⇒ 用功能不可用去换一个弱化攻击面，不值。这条边界的口径写在 README 里，不含糊过去。
 */
export function assertPaidSafe(out: string, id: string): string {
  const reject = (what: string): never => {
    throw new Error(
      `Refusing to return output for paid capability "${id}": it contained a non-catalog URL (${what}). ` +
      `Only the site root and /products, /collections, /pages and /cart routes on ${SITE} are allowed ` +
      `in paid output. This is a bug in the catalog data or in this server — please report it.`
    );
  };

  for (const token of out.split(SEPARATORS)) {
    if (!token) continue;
    // 🔴 **在 token 里搜索地址的起点，而且要看每一个起点，不能只看第一个。**
    //    ① 不要求出现在开头：我们的文案是中文的，实测一个**全角冒号**
    //       （`：https://evil.example/x`）就绕过了"必须开头"的写法，而分隔符补不全。
    //    ② 必须遍历所有候选位置：只取第一个的话，`a:/https://evil.example/x` 里
    //       `a:/` 会先被解析成没有主机名的 opaque URL 而跳过，**后面真正的地址再也不会被看到**。
    //    ⚠️ scheme 后必须跟斜杠：否则 `install:` `purchase:` `page:` 这些标签会被当成 scheme
    //       （`new URL("install:")` 能解析、origin 是 "null"），把正常输出全拒掉。
    for (const at of token.matchAll(/[a-z][a-z0-9+.-]*:[/\\]{1,2}|[/\\]{2}/gi)) {
      if (at.index === undefined) continue;
      const candidate = token.slice(at.index);
      const schemeRelative = /^[/\\]{2}/.test(candidate);

      let u: URL;
      try { u = new URL(schemeRelative ? "https:" + candidate : candidate); }
      catch { reject(candidate.slice(0, 60)); continue; }   // 像绝对地址却解析不了 → fail closed

      // 解析得出但没有主机名的（opaque URL，如 mailto:）不是网络地址；
      // 注意这里只跳过**这一个候选**，同一 token 里后面的候选照查不误。
      if (!u.hostname) continue;

      if (u.protocol !== "https:" || u.origin !== SITE_ORIGIN || !ALLOWED_PATH.test(u.pathname)) {
        reject(`${u.origin}${u.pathname}`);
      }
    }
  }
  return out;
}
