# 技能管理（Skill Manager）· DSH 本地插件

一个 DeepSeek Harness 本地插件（bundle）：**把本地技能包目录加进来 → 在技能包树里展开查看技能 → 用开关决定是否加载。**

- 🗂 **添加目录即接入技能包**：在 Web 设置页里选目录（或手动输入路径），插件会递归扫描其中的技能包。
- 🌲 **技能包树形列表**：每个技能包一行（父行），包内技能缩进为子行，左侧用「竖脊 + 圆角肘线」连成树；父行可展开/折叠，也可一键全部展开/折叠。
- 🎛 **新会话技能选择**：新会话行（和输入框左侧）有「本次会话技能」按钮，点开勾选本次会话加载哪些技能；只影响该会话，全局开关与其它会话不变。
- 🔍 **开关即加载/卸载**：子行右侧的开关立刻生效；关闭的技能从会话技能目录消失，模型无法通过 `skill` 工具加载，`/技能名` 也不再可用。
- 💾 **状态持久化**：目录列表与开关写入 `$DSH_HOME/skill-market/registry.json`，重启后保持。
- 👀 **目录监听**：目录内新增/删除/修改技能会自动重新扫描并刷新模型可见的技能目录（资源文件变动会被忽略）。

---

## 1. 安装

插件包目录：`D:\DSH_PLUGIN\skill-market`（这就是一个 DSH bundle：`package.json` + `cordis.patch.yml` + Host/Client 两半）。

在会话里让 Agent 执行：

```
plugin_manager  action: install_bundle  target: D:\DSH_PLUGIN\skill-market
```

`install_bundle` 会自己完成依赖安装与 bundle 选择（本插件没有任何第三方依赖，只用 `node:` 内置模块），**不要**手工改 profile 的 `package.json` / `cordis.patch.yml`，也不要手动跑 pnpm。

安装后有两个入口（同一套内容，任选其一）：

1. **左侧图标栏**：在「插件」图标下方新增一个「技能管理」图标，点开就是技能包树；
2. **设置页**：左下角 **设置（Settings）** → 左侧导航 **技能管理 / Skill Manager**（在「插件」和「智能体预设」之间）。

也可以在 **设置 → 插件 → 插件列表** 里看到已安装的 `技能市场`（bundle `@local/dsh-skill-market`）来确认安装成功。

> ⚠️ **修改过 `index.js`（Host 半）之后必须重启 DeepSeek Harness**：运行中的 Host 插件是「安装那一刻」的模块世代，插件管理页的启用/禁用只会重跑 `apply()`，不会重新导入模块；HMR 默认只监听 profile 目录，不监听本工作区目录。若 Host 半是旧世代，页面会提示「技能管理服务还没加载（Host 半是旧版本）」。
> Client 半（`client.js`）是浏览器按 URL 拉取的 bundle，**刷新页面**即可拿到最新版本。

---

## 2. 使用

### 添加技能目录

三种方式，任选其一：

| 方式 | 说明 |
|---|---|
| **添加技能目录** 按钮 | 打开系统目录选择器，选中一个目录即注册 |
| 输入框手动输入 | 例如 `D:\AI\mattpocock-skills`，回车或点「添加」 |
| **使用默认目录** 按钮 | 创建并注册 `$DSH_HOME/skill-market/skills`，之后把技能包丢进去即可 |

添加后立即扫描。目录行会显示该目录下发现的技能数、是否为内置技能根目录、目录是否还存在；右侧「移除」只把目录移出管理列表，**不会删除磁盘文件**。

### 技能包（一整套技能体系）

**添加哪个目录就只扫哪个目录，只往下扫，永远不往上扫。** 你输入 `D:\AI\skills\reverse-engineer-anything`，插件只注册并递归扫描这一个目录（默认 8 层），不会因为上层 `D:\AI` 里有 `skills/` 目录就把 `D:\AI` 当成技能包加进来，也不会扫描 `D:\AI` 下的其它文件夹。

- **不会自动向上找包**：添加目录时不做任何父目录探测，`addDir` 注册的就是你给的那条路径（规范化后），返回值和快照里的 `dirs` 也只会是它。
- **整包是一个手动动作**（需要显式开启）：把配置 `packDetection` 设为 `true` 后，如果某个已注册目录只贡献 ≤1 个技能、而它的上层确实是一个技能包，目录行会出现黄色提示「识别到所属技能包：…（N 个技能）」+「**改为添加技能包**」按钮；点一下才会把注册项换成整包（磁盘文件不动）。不点，就永远只加载你加的那个目录。
  - 判定优先级：带**强标记**的祖先（含 `skills/` 目录，或含 `.claude-plugin/`）优先；没有强标记时，只有「技能所在的那一级父目录」才按扁平包 `<包>/<技能>/SKILL.md` 处理。
- **按目录批量开关**：每个目录行有「本目录全开 / 本目录全关」，只影响该目录（该包）下的技能，不会动别的包。
- **面板会自己刷新**：面板重新可见时会重新读取（设置面板会把访问过的页保持在挂载状态），并在可见时每 10 秒用轻量 `revision` 探测一次，只有版本变了才重新拉取完整快照。因此在别处（另一个窗口、另一个会话、脚本改 `registry.json`）做的改动会自动出现在页面上。
- **递归深度默认 8 层**（`maxDepth` 可配），因此 `<包>/skills/<分类>/<子分类>/<技能>/SKILL.md` 这种嵌套也能读到。

### 技能包树（展开 / 折叠）

「技能包」区是一个两层的展开列表：

| 层级 | 内容 |
|---|---|
| **父行**（技能包） | 目录名 + 完整路径 + 计数（`N 技能 · M 已启用 · K 无效`）+ 状态标签（`未扫全`/`内置目录`/`来自配置`/`目录不存在`/`建议整包`）+ 包级操作（本目录全开/全关、改为添加技能包、移除） |
| **子行**（技能） | 技能名 + 简介（单行省略，悬停看完整文本与「适用场景」）+ 调用策略标签 + 相对路径 + 开关；无法解析的文件以虚线红框子行显示原因 |

- 默认**折叠**：先看包，再展开看技能；「展开全部 / 折叠全部」一次处理所有包。
- 展开状态按目录路径保存，面板自动刷新（10 秒一次的 `revision` 探测、重新可见时的静默刷新）不会把已展开的包合上。
- 顶部筛选框输入关键词后：**只显示有匹配的包并自动展开**，只列出匹配的子行（名称、简介、相对路径任一命中）；清空后恢复原来的展开状态。
- 子行连接线是纯主题 token 绘制（`--dsw-alias-border-l2`），浅色/深色主题下都跟随主题。
- **面板可滚动**：侧栏面板是固定高度列，内容区独立纵向滚动（细滚动条、跟随主题、`scrollbar-gutter: stable`）；展开几百个技能也能滚到最后一行。设置页由外壳的设置内容区滚动，不会出现两层滚动条；若宿主容器本身不滚动（旧版设置弹窗或容器裁切内容），区块会在运行时探测最近的滚动祖先，只有在没有滚动祖先时才自己接管滚动（`.dsm-root-scroll`）。

### 新会话技能选择（按会话加载）

新建会话时，New Session 行右侧的 **本次会话技能** 按钮（已有会话则在输入框左侧的图标按钮）会打开一个下拉弹窗：

- 列出当前**全局已启用**的技能，按技能包分组，带勾选框与搜索框；**弹窗打开时所有技能包默认折叠**，点行首箭头展开；每个包行最前面还有一个勾选框，可一键开/关整包技能；标题栏有「展开全部 / 折叠全部」；
- 底部显示「已选 N / 共 M」，支持「全选 / 清空」；面板宽 380px、最高 480px（或 60vh），技能再多也只滚动列表；
- 取消勾选的技能在该会话内不再出现在模型技能目录、`skill` 工具拒绝加载、`/` 菜单也不列出；
- 选择写入 egistry.json 的 sessions[sessionId]，重启后该会话仍生效；
- 只影响本会话：全局开关、其它会话与技能管理页面的状态都不变。

> 实现方式：技能注册表会把调用方的 scope（即 Agent/会话）原样交给每个 provider 的 list()，本插件的 provider 按该会话的排除表过滤候选；dsh-tool-skill 发布目录、skill 工具与 / 菜单都走这个入口。注册表按 scope 缓存目录，选择变更时插件调用 control.invalidate() 让缓存失效。旧 Host 没有该端点时按钮自动隐藏。

### 开关技能

每个技能子行右侧是开关（`role="switch"`）：

- **开**：技能进入会话技能目录，模型可用 `skill` 工具加载，用户可用 `/技能名` 直接注入；
- **关**：技能立刻退出会话技能目录，`skill` 工具与 `/` 菜单都不再提供它。

工具栏还有「全部启用 / 全部停用」「刷新」，以及按名称/简介筛选的输入框（技能包目录里动辄几百个技能时很好用）。

### 调用方式（子行标签上直接写着）

| 调用者 | 方式 |
|---|---|
| 模型 | 调用 `skill` 工具，`name` = 子行上的技能名（技能目录里只给模型名称 + 简介，说明正文在调用时才加载） |
| 用户 | 在输入框里输入 `/技能名`，该技能的完整说明会注入这一步 |
| 关闭时 | 两者都不可用 |
| 技能自身声明 | `disable-model-invocation: true` → 仅用户可调用；`user-invocable: false` → 仅模型可调用（子行上有对应标签） |

---

## 3. 技能包格式

一个技能包是**含 `SKILL.md` 的目录**，或**技能目录根部的一个 `<名称>.md` 文件**：

```
我的技能目录/                     ← 添加这个目录
├── 写作助手/
│   └── SKILL.md                 ← 目录包
├── 日报整理.md                   ← 扁平文件包
└── 第三方技能仓库/                ← 允许嵌套（默认最深 8 层）
    └── skills/
        └── engineering/
            └── code-review/
                ├── SKILL.md
                ├── references/      ← 资源目录，不会被当成技能
                └── scripts/
```

`SKILL.md` 必须以 YAML frontmatter 开头：

```markdown
---
name: code-review                 # 必填，kebab-case（小写字母/数字/单连字符）
description: 审查代码改动并给出可执行建议   # 必填，非空
whenToUse: 当用户要求 review PR 或检查改动时   # 可选
disable-model-invocation: false   # 可选，true = 模型不可调用
user-invocable: true              # 可选，false = 用户不可用 /名称 调用
metadata:                         # 可选，任意键值
  owner: team-a
---

# 正文（技能被加载时注入给模型的完整说明）
```

布尔值接受 `true/false`、`yes/no`、`on/off`、`1/0`（大小写不敏感）；写成别的会被判定为无效技能并出现在页面的「无法解析的条目」里，附带原因。

### 与内置 `skill-filesystem` 提供器的区别

| | 内置提供器 | 本插件 |
|---|---|---|
| 扫描深度 | 只扫一层：`<root>/<name>/SKILL.md`、`<root>/<name>.md` | 递归到 `maxDepth` 层（默认 8），因此能直接吃下「仓库 + skills/分类/技能」结构的技能包 |
| 开关 | 只能靠改配置或删文件 | 每个技能一个开关，立即生效 |
| 展示 | 只有模型侧技能目录 | 技能包树（父行 = 包，子行 = 技能）+ 简介 + 调用策略 + 无效原因 |

两者可以共存：内置提供器照旧扫描 `$DSH_HOME/skills`、`~/.agents/skills`、项目 `.dsh/skills` 等目录；本插件对**自己管理的目录**里的技能以更高优先级（`rank = 50`）参与同名解析。

---

## 4. 关闭语义（为什么关了就不会再被加载）

`ctx.skills` 注册表在同一层里按 `rank` 选同名技能的赢家。本插件的提供器 `rank = 50`，低于内置文件系统提供器的 100/200/300/400/500/600：

- 技能**开启**时：由本插件提供该技能（读取的是同一个 `SKILL.md`）；
- 技能**关闭**时：本插件仍然以该技能名返回一个**屏蔽候选**（`modelInvocable: false, userInvocable: false`）。注册表保留四种调用策略组合，模型侧目录与 `/` 菜单都会过滤掉它——所以即使同一技能也被内置提供器扫到了，开关依然有效，不会被「绕过」。

因此：**关闭 = 该技能名在模型与用户两个入口都不可用**，而不是「只是不在列表里显示」。

---

## 5. 状态、配置与通信

### 两半之间怎么通信

设置页需要读/写 Host 侧状态，走的是**框架自带的鉴权 Fetch 通道**，两条路径共用同一个分发器：

```
首选  POST api/skill-market/<endpoint>     ← 相对 URL，随页面挂载点解析，自动带 cookie
      Host: ctx.connection.fetch.register({ path:'/api/skill-market/<endpoint>',
                                            methods:['POST'], requestBody:'buffered', fetch })
      框架的 /api 桥先做 connection.admit()（Host/Origin 信任 + 浏览器会话），
      再按精确路径分发；本插件不再手写 IncomingMessage 处理。

兼容  POST skill-market/<endpoint>         ← 旧版页面仍可用
      Host: ctx.webServer.register({ kind:'prefix', path:'/skill-market' })，自行 admit()
```

端点是：`snapshot`、`revision`、`addDir`、`removeDir`、`replaceWithPack`、`setEnabled`、`setAllEnabled`、`ensureDefaultDir`、`refresh`、`pruneDisabled`；统一返回 `{ ok: true, value }` 或 `{ ok: false, error: { code, message, details } }`。
请求体上限 1 MiB：非 `application/json` → 415，超限 → 413，坏 JSON → 400。

> 为什么不用 `ctx.connection.rpc.handle()`：该 API 是通过 Connection 服务自己的 context 注册路由的（`owner.webServer`），而 `dsh-client-connection` 的插件 `inject` 只有 `credentials`，因此 `owner.webServer` 无法解析，注册会抛 `cannot get property "webServer" without inject`，路由不会出现在 web server 上（rc.3 仍如此，已用最小 Cordis 复现）。`connection.fetch` 没有这个问题：它只把路由放进自己的表里，用调用者的 `effect` 管生命周期。旧前缀路由作为旧页面的兼容路径保留。

### 状态文件

```
$DSH_HOME/skill-market/registry.json
{
  "version": 1,
  "dirs": ["D:\\AI\\mattpocock-skills"],
  "disabled": ["code-review"]
}
```

写入是原子且先写后提交的（临时文件 → fsync → rename → 才更新内存）；**形状错误或版本不符的文档不会覆盖现有状态**，会在页面上显示「注册表读取失败」并沿用上一次的状态。失效的停用名（技能被删/改名）会在页面提示并可一键「清理」。手工编辑该文件也会被监听到并自动生效（适合脚本批量开关）。

### 插件配置（`cordis.patch.yml` 里那一行的 `config`）

| 字段 | 默认 | 说明 |
|---|---|---|
| `skillDirs` | `[]` | 部署级补充目录（只读，页面上不能移除），相对路径按进程工作目录解析 |
| `maxDepth` | `8` | 递归扫描的最大深度（0 = 只看根目录的扁平 `.md` 与一级 `SKILL.md`） |
| `packDetection` | `false` | 向上找技能包的手动入口：设为 `true` 才会在窄目录行给出「改为添加技能包」提示与按钮（仍然要你点，添加目录本身永远只向下扫） |
| `watch` | `true` | 监听技能目录与状态文件，变化时刷新模型技能目录 |
| `statePath` | `$DSH_HOME/skill-market/registry.json` | 状态文件位置 |
| `defaultSkillDir` | `$DSH_HOME/skill-market/skills` | 「使用默认目录」按钮使用的目录 |
| `dshHome` / `agentsHome` | `$DSH_HOME` / `$DSH_AGENTS_HOME` | 仅用于推导上述默认路径与标记「内置目录」 |
| `maxDirectories` / `maxSkills` | `4000` / `500` | 单个目录的扫描预算，防止超大目录树拖慢扫描 |

配置没有声明 schemastery `Config`：`link:` 安装的工作区包无法解析 `@deepseek-ai/schemastery`（profile 的 `node_modules` 不是插件的祖先目录，实测 `ERR_MODULE_NOT_FOUND`），而引入第三方依赖会破坏零依赖安装。取而代之的是**配置诊断**：非法类型/越界值/未知字段（例如 `maxdepth`、`maxDepth: "8"`、`watch: "yes"`）会出现在页面提示与快照 `config.warnings` 里，插件按默认值继续工作。`package.json` 另声明了 `engines.dsh`（`>=0.2.1-rc.3 <0.3.0`）用于表达兼容范围。

---

## 6. 已知限制

- **UI 只在 Web 端**：Client 半注册到 `settings.section`，需要 `dsh-client-ui-settings` 所在的 Web/Desktop 组合；Host 半（技能提供器、开关语义、浏览器传输）没有这个依赖，无头部署下依然按注册表加载技能。
- **改 Host 代码要重启应用**：运行中的插件是安装时的模块世代（`link:` 安装路径不变 ⇒ Node ESM 缓存不失效）。改 `client.js` 刷新页面即可，改 `index.js` / `lib/*` 需要重启 DeepSeek Harness。
- **不是在线技能市场**：没有远程下载/更新，只有本地目录；「加一个技能包」= 「添加一个目录」。
- **技能名必须是 kebab-case**：frontmatter 里写成 `Environment Setup` 这类名字会被 DSH 注册表拒绝，插件会把它列进「无法解析的条目」而不是猜一个名字。
- **同名技能**：先添加的目录优先；被覆盖的条目会在「被同名技能覆盖」里列出。注意 `rank = 50` 的**已启用**技能也会盖住项目级（100–500）同名技能——monorepo 里若想保留项目内覆盖，不要把同名技能放进本插件管理的目录。
- **上下文成本**：启用的技能都会出现在会话技能目录里，几百个技能会明显拉长提示词——页面上超过 40 个启用技能时会给出提示。
- **`/` 菜单缓存**：rc.3 的 `dsh-client-ui-skill` 按会话缓存技能列表，只在预设切换/插件管理操作/连接重置时失效；因此在面板里关掉技能后，输入框的 `/` 建议可能短暂仍是旧列表（该技能本身已不可加载）。刷新页面或切换预设即可刷新菜单。
- **配置没有 JSON Schema**：原因与替代方案见上一节；改配置后请留意页面上的「配置问题」提示。
- **浏览器往返未做端到端点击验证**：本环境没有浏览器控制能力；已验证的是真 socket 往返（两种传输）、鉴权围栏、处理器逻辑、Client 渲染与发出的请求、两半契约，以及真实大目录的性能。页面的像素级外观与真实点击仍需一次人工确认。

---

## 7. 目录结构 / 开发 / 验收

```
skill-market/
├── package.json          # bundle 清单：dsh.bundle.patch + dsh.client + icon/locale + engines
├── cordis.patch.yml      # 插入 Host 行 skill-market
├── index.js              # Host 半：技能提供器、注册表、扫描缓存、监听、双传输端点
├── client.js             # Client 半：settings.section 页面 + 侧栏面板（技能包树 + 开关），浏览器 bundle
├── lib/
│   ├── frontmatter.js    # YAML frontmatter 子集解析 + 严格校验 + BOM 处理
│   ├── scan.js           # 递归技能发现、无效条目、同名覆盖、预算截断标记、监听过滤
│   └── store.js          # registry.json 原子读写（fsync + 先写后提交）与失效名清理
├── locale/{zh,en}.json   # 插件管理页显示用的标题/简介
├── icon.svg
├── ACCEPTANCE.md         # 验收标准与验收结果
├── test/
│   ├── harness.mjs            # 测试用最小 Cordis / React 桩 + 真 HTTP 桥模拟
│   ├── skill-market.test.mjs  # 纯逻辑：frontmatter / 扫描 / 注册表 / 监听过滤
│   ├── host.test.mjs          # Host 半：真实 apply() + 提供器 + 两种传输 + 真 socket
│   ├── client.test.mjs        # Client 半：渲染冒烟 + 两半契约 + 降级/归一化
│   ├── tree.test.mjs          # AC-13：技能包树（结构/展开/筛选/包级操作/连接线）
│   ├── session-skills.test.mjs # AC-15：会话技能选择器（入口/弹窗/勾选/降级）
│   └── acceptance.mjs         # 可重复执行的 AC 验收脚本（临时 HOME）
└── ...
```

跑测试与验收（无需安装任何依赖）：

```powershell
$node = "C:\Users\G\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
& $node --test test/skill-market.test.mjs test/host.test.mjs test/client.test.mjs test/tree.test.mjs test/session-skills.test.mjs   # 63 个用例
& $node test/acceptance.mjs                                                        # 31 条 AC 检查
```

测试覆盖（63 个用例 + 31 条验收检查）：

- **纯逻辑**：frontmatter 解析与拒绝规则（含 BOM）、递归扫描（嵌套/扁平/噪音目录/深度上限/同名覆盖/预算截断）、监听事件过滤、注册表读写与形状校验、失效名清理；
- **Host 半**：真实 `apply()` + 提供器 + 全部端点，覆盖屏蔽候选、技能包识别与替换、配置诊断、不完整上报、失效停用名；
- **真 socket**：真实 `node:http` + `fetch`，验证两种传输都返回非空快照、第二次命中缓存、addDir 内联快照、鉴权围栏（这一层专门防「假 EventEmitter 掩盖请求生命周期缺陷」）；
- **Client 半**：真实浏览器 bundle + 最小 React 桩，覆盖技能包树（展开/折叠/全部展开/筛选/计数/包级操作/无效子行/连接线/面板滚动）与会话技能选择器（入口/弹窗/勾选/旧 Host 降级）、开关与 `aria-checked`、特性门控、404 降级到旧路径、缺失 `invocation` 的归一化、失效名清理按钮；
- **两半契约**：把 Host 半真实产出的 snapshot 直接喂给 Client 半渲染；
- **验收脚本**：逐条执行 `ACCEPTANCE.md` 的 AC-1 … AC-17，并在真实大目录上给出首/次快照耗时。

---

## 8. 验收

验收标准见 [ACCEPTANCE.md](ACCEPTANCE.md)（AC-1 … AC-17，含每条的判定方式与最终结果）。本轮修复前后的关键差异：

| 项目 | 修复前 | 修复后 |
|---|---|---|
| 面板数据 | 每次快照都因请求 `close` 取消扫描而返回空列表 | 真 socket 返回完整技能列表（AC-1.1/1.2 实测） |
| 快照成本（399 技能） | 每次 445–478 ms / 422 KB | 首次约 450 ms，后续约 6 ms（缓存，AC-3.4） |
| 传输 | 手写 `IncomingMessage` 前缀路由 | 框架 `connection.fetch` 精确路由 + 旧路径兼容 |
| 监听 | 任意文件变更都触发全量重扫 + 模型目录重发 | 仅 `SKILL.md`/结构变化触发 |
| 配置 | 拼错静默按默认 | 页面显示配置问题 |
| 状态损坏 | 可解析但形状错误的文档会清空内存状态 | 保留原状态并提示 |
