<p align="center"><b>简体中文</b> | <a href="README.md">English</a></p>

<h1 align="center">agentskill-mcp</h1>

<p align="center">
  <b>让你的 agent 自己找到并装上缺的那个能力</b><br>
  MCP 服务 · 策展目录 · 免费项直接下载 · 中英文都能搜
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="MIT">
  <img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen" alt="node >=18">
  <img src="https://img.shields.io/badge/MCP-2026--07--28-blue" alt="MCP spec">
  <img src="https://img.shields.io/github/stars/simonlin1212/agentskill-mcp?style=flat" alt="stars">
</p>

<p align="center">
  <a href="#它做什么">它做什么</a> ·
  <a href="#安装">安装</a> ·
  <a href="#三个工具">三个工具</a> ·
  <a href="#目录里有什么">目录</a> ·
  <a href="#它的行为准则">行为准则</a> ·
  <a href="CHANGELOG.md">更新日志</a>
</p>

---

## 它做什么

agent 碰到一件它干不了的事——取 A 股行情、让另一个模型复审这段 diff、把访谈转成文字、
去掉图上的水印、把某个网站的设计体系扒下来。世上多半已经有个 skill 文件能解决，
麻烦的是找到它。

这个服务把一份小而经过核对的目录放进 agent 里。它能搜、能读到交付事实、能直接说出该跑哪条命令。
免费的给出直链，付费的给出价格，不带推销话术。

目录是 [agentskill.nz](https://agentskill.nz)，**刻意做得小**。公开的 skill 目录动辄几十万条且无人核验——
实测平均质量约 6/12，约三分之一带 prompt injection 风险。这里每一条都写明：它做什么、
需要什么才能跑、拿什么实测过、以及在哪儿就不行了。

## 安装

不用装。让 MCP 客户端指向它即可：

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

Claude Code：

```bash
claude mcp add agentskill -- npx -y @simonlin1212/agentskill-mcp
```

需要 Node 18+。无需配置、无需 API key、无需注册。服务本身不保存状态，也不往你机器上写任何东西。

## 三个工具

| 工具 | 回答什么问题 |
|---|---|
| `search_capabilities` | 「有没有做 X 的？」可按关键词、模块、免费/付费过滤。 |
| `get_capability` | 「我到底拿到什么，怎么拿？」版本、文件大小、更新日期、来源仓库、获取路径。 |
| `list_modules` | 「这里都有些什么？」四个模块及数量，两种交付形态的区别。 |

搜索把中英文并进同一个索引，所以 `去水印` 和 `remove watermark` 命中同一条；
不管用哪种语言查，结果都会同时给出两种名称。

## 目录里有什么

四个模块——金融、电商、自媒体、通用——两种形态：

- **Install Skill**：agent 直接加载的技能文件，拷进它的 skills 目录即可。
- **Deploy App**：带界面、能自己跑起来的应用，部署后配合 agent 使用。

大约一半是免费的。其中若干是公开仓库的打包版本，这些仓库合计 16,000+ GitHub star；
凡是基于开源上游做的能力，商品页都写明上游项目及其许可证。

## 它的行为准则

这是查目录的工具，不是广告位。三条规矩：

- **免费就是免费**：直接给 ZIP 地址，不注册、不设门。
- **付费只报价，不劝**：没有紧迫感话术，没有推荐语。付费项的下载链接在付款后由订单页和邮件发出，
  **这个服务永远不会返回付费文件的地址**。
- **安装命令是信息，不是授权**：每次返回都会写明这一点。动你的文件系统或花你的钱之前，
  agent 应该先问你。

目录地址是运行时从站点的 `/llms.txt` 发现的，不写死在代码里——站点换地址时服务照常能用。

## 从源码构建

```bash
npm install
npm run build
node test-smoke.mjs    # 用真实 MCP stdio 协议打一遍服务器
```

`test-smoke.mjs` 走的是线上协议而不是直接 import 模块，所以能抓到注册与传输层的问题——
那类问题单元测试看不见。它同时断言：任何付费项都不会返回文件地址。

## 更新日志

见 [CHANGELOG.md](CHANGELOG.md)。

## 免责声明

这个服务只是读取目录并如实返回，它不判断某个能力是否适合你的场景，也不执行任何东西。
skill 文件是你的 agent 会读取并据以行动的代码，**使用前请像对待任何依赖一样先看一遍**。

## 赞赏

如果它帮你省了点时间 ☕

<p align="center">
  <a href="https://buymeacoffee.com/simonlin1212"><img src="./assets/bmc-qr.png" width="180" alt="Buy Me a Coffee"></a>
</p>

## License

MIT

**作者：** Simon 林 · X [@linsizhen](https://x.com/linsizhen) · 邮箱：[simonlin0423@gmail.com](mailto:simonlin0423@gmail.com)
