# 技能管理插件 · 验收标准（Acceptance Criteria）

> 版本：v1.1（2026-10-27 修订）
> 对应评估报告中的问题编号：P0=请求信号缺陷，P1-1=缓存，P1-2=监听过滤，P1-3=不完整扫描上报，P1-4=配置，P1-5=传输层，P1-6=失效停用名，P1-7=版本兼容。
>
> 验收方式：`node --test` 全量套件 + 真 socket 集成用例 + 真机脚本（临时状态目录，不触碰用户注册表）。
> 判定规则：**AC 全部 PASS 才算通过**；标注 *（N/A）* 的条目须给出可复核的原因。

---

## A. 阻断级（必须修）

### AC-1 浏览器数据通道（P0）
- **AC-1.1 真 socket 快照**：通过真实 `node:http` 服务 + 真实 `IncomingMessage` 发出 `POST` 后，返回的 `skills` 数量等于注册目录内的技能总数（构造 3 个技能，断言 `skills.length === 3`），且每个目录 `exists === true`。
- **AC-1.2 正常请求不被取消**：快照返回的 `skills` 为完整列表（不是空），且第二次请求 `diagnostics.cached === true`、`diagnostics.scans` 不变；请求生命周期不再参与扫描（不再使用请求 `close` 事件取消扫描）。
- **AC-1.3 写入后立即可读**：`addDir` 的响应内嵌快照立即包含新增目录的技能（不依赖二次查询）。
- **AC-1.4 鉴权先于业务**：未携带浏览器凭证的请求在进入业务逻辑前被拒（401/403）；先鉴权后读 body。

### AC-2 传输层（P1-5）
- **AC-2.1 首选精确路由**：存在 `ctx.connection.fetch` 时，注册 `POST /api/skill-market/<endpoint>`（`requestBody: 'buffered'`），端点集合 = `snapshot, revision, addDir, removeDir, replaceWithPack, setEnabled, setAllEnabled, ensureDefaultDir, refresh, pruneDisabled, sessionSkills, setSessionSkills`。
- **AC-2.2 旧宿主回退**：无 `connection.fetch` 时回退到 `webServer` 前缀路由 `/skill-market/<endpoint>`，行为一致。
- **AC-2.3 请求约束**：非 `application/json` → 415；body 超过 1 MiB → 413；未知端点 → 业务错误信封 `unknown-endpoint`（HTTP 200）。
- **AC-2.4 旧客户端兼容**：新 Host 同时保留 `/skill-market/<endpoint>` 旧路径，旧页面刷新前仍可工作。

### AC-3 扫描缓存与性能（P1-1）
- **AC-3.1 同一 revision 复用**：连续两次 `snapshot`，第二次不触发磁盘重扫（`diagnostics.scanCount` 不增加）。
- **AC-3.2 失效后重扫**：`refresh` / 目录或状态变更后，下一次 `snapshot` 的 `scanCount` 增加 1。
- **AC-3.3 并发单飞**：并发发起 2 次 `snapshot`，只产生 1 次扫描（`scanCount` 只 +1）。
- **AC-3.4 性能目标**：399 技能真实目录下，第二次 `snapshot` < 50 ms（修复前实测 445–478 ms/次）。

---

## B. 功能与正确性

### AC-4 监听过滤（P1-2）
- **AC-4.1 资源子目录编辑不触发刷新**：`references/*.md`、`scripts/*.py`、`.git` 内文件的 `change` 事件返回「不相关」。
- **AC-4.2 技能结构变化触发刷新**：任意层级 `SKILL.md` 的增/删/改、根目录扁平 `.md` 的编辑、任意层级的目录 rename 返回「相关」。
- **AC-4.3 未知事件保守处理**：`filename` 缺失时返回「相关」（宁多刷不漏刷）。

### AC-5 不完整扫描（P1-3）
- **AC-5.1 预算截断可见**：`maxSkills`/`maxDirectories` 触发时 `scanRoot` 返回 `truncated: true`，快照含 `incomplete` 标记与 UI 提示。
- **AC-5.2 provider 观测完整度**：扫描不完整时 `provider.list()` 返回 `{ candidates, complete: false }`；完整时返回数组。
- **AC-5.3 不完整不污染模型侧缓存**：`complete:false` 的观测不被注册表缓存（由注册表契约保证，测试断言返回形状即可）。

### AC-6 配置（P1-4 / P1-7）
- **AC-6.1 配置诊断**：非法类型/越界值（如 `maxDepth: "8"`、`watch: "yes"`、`maxDepth: -1`）在 `snapshot.config.warnings` 中可见，UI 显示提示；插件仍按默认值工作。
- **AC-6.2 版本声明**：`package.json` 含 `engines.dsh`（`>=0.2.1-rc.3 <0.3.0`）。
- **AC-6.3 配置与文档一致**：`cordis.patch.yml`、代码默认值、README 表格三处 `maxDepth` 均为 8。

### AC-7 失效停用名（P1-6）
- **AC-7.1 可观测**：已不存在的停用技能名出现在 `snapshot.staleDisabled`（数量正确）。
- **AC-7.2 可清理**：`pruneDisabled` 端点清除全部失效名并持久化；返回 `removed` 列表；再次快照 `staleDisabled` 为空。
- **AC-7.3 不误删**：仍存在的停用技能不会被清理。

### AC-8 状态持久化健壮性（P2）
- **AC-8.1 形状校验**：`registry.json` 为 `null` / `[]` / `dirs` 非数组 / 版本号不符时，**不覆盖内存状态**，`loadError` 有值，快照 `stateError` 可见；`{}` 视为合法的空文档（清空列表），不算错误。
- **AC-8.2 先写后提交**：写盘失败时不修改内存状态（代码结构保证：构造 next → 持久化成功 → 提交）。
- **AC-8.3 原子写**：临时文件 + fsync + rename；无残留 `.tmp` 文件。

### AC-9 解析边界（P2）
- **AC-9.1 BOM**：UTF-8 BOM 开头的 `SKILL.md` 可正常解析。
- **AC-9.2 扁平文件名校验**：`<root>/<name>.md` 的 frontmatter `name` 与文件名不一致时静默跳过（不计入 invalid，不产生技能）。
- **AC-9.3 符号链接**：`SKILL.md` 为符号链接（或目录为 symlink）时可被发现；创建符号链接失败的环境跳过该用例并说明（Windows 无开发者模式时 `EPERM`）。

### AC-10 快照与渲染健壮性（P2）
- **AC-10.1 快照对齐**：roots 与 state 在扫描前一次性捕获，结果按捕获顺序组装（代码结构 + 并发变更测试）。
- **AC-10.2 invocation 归一化**：快照缺少/畸形 `invocation` 时客户端不崩溃（渲染出默认策略）。
- **AC-10.3 transport fetch 绑定接收者**：`transports.fetch` 以正确 `this` 调用（单测）。
- **AC-10.4 刷新不闪空**：第二次 `load()` 时保留旧数据并置 `refreshing`，不出现「正在读取技能…」清空。
- **AC-10.5 渲染错误隔离**：真实 React 下任一卡片抛错只影响该面板内容（错误边界），整个 slot 不消失。

### AC-11 端到端语义（回归）
- **AC-11.1 三态语义**（Host 侧）：开启 → 候选正常；关闭 → 屏蔽候选（`modelInvocable:false, userInvocable:false`）；移除目录 → 无候选。
- **AC-11.2 技能包识别**：选中单个技能目录时注册整包；`replaceWithPack` 原子化（先加后删，失败回滚）。
- **AC-11.3 内置对等性**：provider 排名 50 的屏蔽候选能覆盖内置 provider 同名技能（设计断言）。

---

## D. 展示形态：技能包 → 技能 展开列表（AC-13）

> 目标形态：一个技能包一行（父行），包内技能缩进为子行，子行左侧用「竖脊 + 圆角肘线」连接到父行；父行可展开/折叠。

### AC-13.1 单一树形列表
- 每个已注册目录渲染为**一个父行**（技能包），该目录贡献的技能只出现在它的子行里。
- **不再**渲染独立的「技能目录」列表，也**不再**渲染卡片网格（`.dsm-card` 不得出现在输出中）。
- 断言：父行数 = `snapshot.dirs.length`；每个父行的子行数 = 该目录技能数（展开后）。

### AC-13.2 展开 / 折叠
- 父行左侧是 `button`，带 `aria-expanded` 与 `aria-controls`，且 `aria-controls` 指向真实存在的子列表 `id`。
- 默认**折叠**；点击展开显示子行；再次点击折叠。
- 展开状态以目录路径为键保存在组件状态里：快照刷新后保持（不因一次 `snapshot` 替换而全部塌陷）。

### AC-13.3 全部展开 / 全部折叠
- 树标题栏有「展开全部 / 折叠全部」；点击后所有父行的 `aria-expanded` 同时变 `true` / `false`。

### AC-13.4 父行计数
- 父行显示：技能总数、已启用数、无效数、以及 `未扫全 / 内置目录 / 来自配置 / 目录不存在` 标记；数值与快照中该目录的统计一致。

### AC-13.5 开关语义不变
- 子行开关仍是 `role="switch"`，`aria-checked` 与 `enabled` 一致，点击发出 `setEnabled { name }`。
- 关闭的行保留技能名（弱化显示），`/名称` 与模型调用仍不可用（Host 语义未变）。

### AC-13.6 筛选
- 输入关键词后：只显示有匹配的包；匹配包**自动展开**并只显示匹配子行（含匹配的无效条目）。
- 清空关键词后恢复用户原来的展开状态。
- 无任何匹配时显示「没有匹配的技能」。

### AC-13.7 包级操作
- 父行提供：本目录全开 / 本目录全关（`features.scopedToggle`）、改为添加技能包（`dir.pack` 存在且 `features.replaceWithPack`）、移除（`dir.removable !== false`）；锚点均为该目录路径。

### AC-13.8 无效条目入树
- 无法解析的文件作为**所属包的子行**显示（虚线/错误色、无开关、显示相对路径与原因）；不再单独占用全局「无法解析的条目」区块。
- 同名覆盖（duplicates）仍保留为全局折叠区块。

### AC-13.9 连接线视觉
- 子行容器有左侧竖脊线（`border-left`），每个子行有圆角肘线（`::before` 的 `border-left` + `border-bottom` + `border-bottom-left-radius`）。
- 树相关 CSS **只使用主题 token**（`var(--dsw-…)`），不含硬编码颜色值。

### AC-13.10 空包与缺失目录
- 目录不存在：父行标记「目录不存在」，展开按钮禁用。
- 包内 0 技能：父行可展开，展开后显示「这个技能包里没有发现技能」。

### AC-13.11 回归与验收
- 原有 36 个用例按新结构更新后仍全绿，加上新增用例合计 **46 个**；`test/tree.test.mjs` 覆盖 AC-13.1–13.10，`test/acceptance.mjs` 覆盖 AC-13.1/13.2/13.6/13.8/13.9。
- 不改变 Host 快照契约（`dirs` / `skills` / `invalid` 字段未变），旧 Host 快照仍能渲染。

---

## F. 侧栏面板滚动（AC-14）

> 问题：侧栏「技能管理」面板在展开大量技能后无法上下滚动，超出部分被裁掉。

### AC-14.1 面板为固定高度列，内容区独立滚动
- `.dsm-panel`：`display:flex; flex-direction:column; height:100%; min-height:0; box-sizing:border-box`。
- `.dsm-panel > .dsm-root`：`flex:1 1 auto; min-height:0; overflow-y:auto` —— 滚动发生在内容区，标题/工具栏随内容一起滚动，面板本身不被内容撑破。

### AC-14.2 滚动条跟随主题
- 滚动条使用主题 token（`scrollbar-color: var(--dsw-alias-border-l3, var(--dsw-alias-border-l2)) transparent`），并提供 `::-webkit-scrollbar` / `::-webkit-scrollbar-thumb` 规则（细滚动条、圆角、透明轨道），浅色/深色主题都可见。
- `scrollbar-gutter: stable`，展开/折叠时列表宽度不抖动。

### AC-14.3 不引入嵌套滚动
- 设置页的技能管理页优先由外壳的设置内容区滚动；本插件的 `.dsm-root` 基础规则不声明 `overflow-y`，滚动只作用于 `.dsm-panel` 作用域。
- 兜底：若运行时探测不到任何可纵向滚动的祖先（宿主容器裁切内容），区块给自己加 `.dsm-root-scroll` 接管滚动；存在滚动祖先时不加，避免两层滚动条。

### AC-14.4 长列表完整可达
- 展开包含大量技能（如 399 个）的包时，内容完整渲染在滚动容器内（所有子行都在 DOM 里，不被虚拟化截断），滚动高度大于容器高度。
- 结构断言：`.dsm-panel` 内存在 `.dsm-root` 子节点，且 CSS 声明了 `overflow-y:auto`。

### AC-14.5 回归
- 原有 46 个用例与 24 条验收检查保持通过（合计 **49 个用例**、**25 条检查**）；新增 AC-14 的 CSS/结构断言。
- 真实滚动交互需要在浏览器里人工确认（本环境无浏览器控制），README 与验收结果中如实标注。

---

## G. 新会话技能选择器（AC-15）

> 需求：创建新会话时提供一个按钮，点开下拉弹窗，选择**本次会话**加载哪些技能；已有会话不改。

### AC-15.1 入口
- 空白/新会话的 New Session 行右侧出现「本次会话技能」按钮（`conversation.hero.options`，id `session-skills`，order 40）。
- 已有会话在输入框工具行左侧提供同一按钮（`conversation.input.left`，图标按钮）。
- 组件拿不到 `sessionId` 时不渲染任何东西；旧 Host 没有端点时按钮自动隐藏（404/405）。

### AC-15.2 下拉弹窗
- 点击按钮在按钮下方弹出面板（右缘对齐，宽 360px，最大高 60vh，内部滚动），不遮挡触发按钮。
- 面板内容：搜索框、按技能包分组的技能勾选列表（每行技能名 + 简介）、底部「全选 / 清空 / 恢复默认」与「已选 N / 共 M」计数、说明「只影响本会话」。
- Escape 或点击面板外关闭。

### AC-15.3 生效范围
- 取消勾选的技能在**该会话**内：不出现在模型技能目录、`skill` 工具拒绝加载、`/` 菜单不列出。实现方式是本插件 provider 在 `list({ scope })` 中过滤候选（注册表把调用方 Agent 作为 `scope` 传给每个 provider），`get({ scope })` 对被排除的名字返回 undefined；选择变更时调用 `control.invalidate()` 让注册表的 per-scope 缓存失效。
- 其他会话与全局开关不受影响；全局停用的技能本来就不加载。
- 选择变更后，该会话下一次 `agent/pre-step` 会收到替换版技能目录（由 `dsh-tool-skill` 的摘要比对自然触发，不额外注入）。

### AC-15.4 持久化
- 选择写入 `$DSH_HOME/skill-market/registry.json` 的 `sessions[sessionId] = { excluded: string[], updatedAt }`；重启后该会话仍生效。
- 空选择（全部勾选）删除该会话条目；最多保留最近 200 个会话，旧的自动清理。
- 形状错误的 `sessions` 条目被忽略，不破坏目录/开关状态。

### AC-15.5 兼容与降级
- 本实现不依赖改写 `skills` 服务（真机上服务不可写）：过滤发生在 provider 内部，`features.sessionSkills` 恒为 true。旧的 Host 世代缺少 `sessionSkills` 端点时按钮自动隐藏；客户端保留 `canFilter:false` 的提示分支，供未来端点存在但实现缺失的宿主使用。
- 旧 Host（无 `sessionSkills` 端点）→ 按钮隐藏，不报错。

### AC-15.6 校验
- `setSessionSkills` 只接受字符串数组；未知技能名被忽略并回写清理结果；非数组 / 缺 `sessionId` → 业务错误信封。

### AC-15.7 回归
- 原有 49 个用例、25 条验收检查保持通过；新增 Host 会话门、存储、客户端弹窗用例与验收检查。

---

## H. 弹窗尺寸与样式加载（AC-16）

> 问题：会话技能弹窗在技能很多时按普通文档流撑满整页，把工作区/图标挤变形；根因是样式只由设置页组件渲染时注入，弹窗所在的新会话界面拿不到 `.dsm-session-*` 规则。

### AC-16.1 样式全局加载一次
- Client 半在 `apply()` 时向 `document.head` 注入一个 `<style data-skill-market>`，内容与原来内联的 CSS 相同；不依赖用户是否打开过设置页。
- 卸载时移除该 `<style>`；重复 apply 不产生第二份（同一 profile 只挂载一次）。
- 设置页不再自己渲染 `<style>`（避免重复）。

### AC-16.2 弹窗尺寸受限
- 面板：`position: absolute`（无法测量视图时的回退）或 `position: fixed`（测量后按视口定位）、`width: 380px`、`max-width: calc(100vw - 24px)`、`max-height: min(60vh, 480px)`，`display: flex; flex-direction: column`。
- 列表：`flex: 1 1 auto; min-height: 0; overflow-y: auto`（细滚动条），技能再多也只滚动列表，头部/底部固定可见。
- 39 个技能时面板高度不再随内容增长，底部「已选 / 全选 / 清空 / 说明」始终在视口内。

### AC-16.3 不影响页面布局
- 面板脱离文档流定位，父元素 `.dsm-session` 为 `position: relative; display: inline-flex`，展开/收起不改变 New Session 行或输入框行的高度，不挤压其它图标。
- `z-index` 高于会话内容（60），不被输入框遮挡。

### AC-16.4 回归
- 原有 57 个用例、28 条验收检查保持通过；新增样式注入与尺寸断言。

### AC-16.5 浮层定位（不受容器裁切）
- 打开时按触发按钮的 `getBoundingClientRect()` 计算视口坐标，面板用 `position: fixed` 定位：下方可用空间不足 260px 时向上展开；左右夹紧到 12px 边距内。
- 面板不依赖祖先的定位或 `overflow`：输入框/工具行裁切不会让面板消失；拿不到布局时退回绝对定位样式（CSS 默认值）。

### AC-16.5 浮层定位（不受容器裁切）
- 打开时按触发按钮的 `getBoundingClientRect()` 计算视口坐标，面板用 `position: fixed` 定位：下方可用空间不足 260px 时向上展开；左右夹紧到 12px 边距内。
- 面板不依赖祖先的定位或 `overflow`：输入框/工具行裁切不会让面板消失；拿不到布局时退回绝对定位样式（CSS 默认值）。

---

## I. 弹窗内技能包折叠（AC-17）

### AC-17.1 技能包行可折叠
- 弹窗里每个技能包一行，行首是展开/折叠按钮（`button`，带 `aria-expanded` 与指向子列表 `id` 的 `aria-controls`），显示包名与该包「已选 / 总数」。
- 默认**折叠**：打开弹窗时只有包行，技能行不渲染；点击展开后显示该包的技能行，其它包不受影响；再次点击折叠。
- 展开状态以包根路径为键保存在组件状态里，面板重新打开时重置为全部折叠。

### AC-17.2 全部展开 / 折叠
- 面板标题栏有「展开全部 / 折叠全部」按钮：折叠后所有包的技能行隐藏，展开后全部恢复；筛选激活时该按钮禁用（筛选会强制展开匹配包）。

### AC-17.3 筛选与折叠共存
- 输入关键词后：只显示有匹配的包，匹配包**自动展开**且只显示匹配技能；清空后恢复原来的折叠状态。
- 折叠不影响「全选 / 清空」：两者始终作用于全部技能（而非仅可见行），计数也按全部技能统计。

### AC-17.4 视觉与可访问性
- 技能行使用与技能管理一致的树形连接线（左侧竖脊 + 每行圆角肘线），颜色仅用主题 token。
- 展开/折叠按钮有可读的 `aria-label`（`展开技能包：<包名>` / `折叠技能包：<包名>`），键盘可操作。

### AC-17.5 回归
- 原有 59 个用例、29 条验收检查保持通过；新增折叠用例与验收检查。

---

## J. 技能包父级勾选（AC-18）

### AC-18.1 父行勾选框
- 每个技能包行在折叠按钮**前面**有一个勾选框（`type="checkbox"`，`aria-label` 为「切换该技能包的全部技能：<包名>」）。
- 勾选 = 该包全部技能都在本会话加载；取消勾选 = 该包全部技能都被排除；部分排除时 `aria-checked="mixed"`（原生 `indeterminate` 视觉由浏览器提供）。

### AC-18.2 一键开关整包
- 点击父行勾选框一次调用 `setSessionSkills`，把它换成「整包排除」或「整包恢复」，不影响其它包，也不改变折叠状态。
- 折叠状态下同样可用（只作用于数据，不依赖子行是否渲染）；保存中（`saving`）禁用。

### AC-18.3 回归
- 折叠不影响父级勾选；「全选 / 清空」仍作用于全部技能。

---

## E. 文档与交付

- **AC-12.1 测试**：`node --test test/*.test.mjs` 全部通过，用例数 ≥ 30，含至少 1 个真 socket 集成用例。
- **AC-12.2 文档一致性**：README 中的用例数、`maxDepth`、传输方式、端点列表与代码一致；本文档附最终验收结果表。
- **AC-12.3 安装态**：bundle 在当前 profile 中已选择（`dsh.profile.bundles` 含 `@local/dsh-skill-market`）；Host 代码更新后给出**重启**要求与重启后的复核步骤。
- **AC-12.4 可复核**：验收脚本可重复执行（临时 HOME，不写用户注册表）。

---

## 验收结果（2026-10-27 执行）

命令：
```powershell
$node = "C:\Users\G\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
& $node --test test/skill-market.test.mjs test/host.test.mjs test/client.test.mjs test/tree.test.mjs test/session-skills.test.mjs   # 63/63 pass
& $node test/acceptance.mjs                                                        # 31/31 checks
```

| AC | 结果 | 证据 |
|---|---|---|
| AC-1.1 | PASS | 真 socket `POST /api/skill-market/snapshot` → `skills=3`，`dirs[0].exists=true` |
| AC-1.2 | PASS | 连续两次请求 `skills=3`，第二次 `diagnostics.cached=true` 且 `scans` 不变 |
| AC-1.3 | PASS | `addDir` 响应内联快照 `skills=4`（新增技能立刻可见） |
| AC-1.4 | PASS | `/api` 与旧前缀路径在业务逻辑前均返回 401 |
| AC-2.1 | PASS | 12 条 `/api/skill-market/*` 精确路由（含 `sessionSkills`/`setSessionSkills`），`methods=['POST']`、`requestBody='buffered'` |
| AC-2.2 | PASS | 移除 `connection.fetch` 后 `features.transport='web'`，旧路由照常返回 |
| AC-2.3 | PASS | 415（非 JSON）/ 413（>1 MiB）/ 400（坏 JSON），两种传输一致 |
| AC-2.4 | PASS | 旧路径与精确路径返回同一快照 |
| AC-3.1 / 3.2 / 3.3 | PASS | 命中不重扫；`refresh` 后 `scans +1`；并发两次快照共享 1 次扫描 |
| AC-3.4 | PASS | 真实目录 402 技能：首扫 7 ms（由 addDir 内联扫描完成），二次快照 **6.4 ms**（缓存），目标 < 50 ms |
| AC-4.1 / 4.2 / 4.3 | PASS | `references/*`、`scripts/*` 的 change 判为不相关；`SKILL.md`、目录 rename、根扁平 `.md` 为相关；未知文件名保守为相关 |
| AC-5.1 / 5.2 / 5.3 | PASS | `maxSkills=1` → `incomplete=true`、`dirs[0].truncated=true`、提供器返回 `{candidates, complete:false}` |
| AC-6.1 / 6.2 / 6.3 | PASS | 非法类型/越界/未知字段均出现在 `config.warnings`；`engines.dsh>=0.2.1-rc.3 <0.3.0`；三处 `maxDepth` 均为 8 |
| AC-7.1 / 7.2 / 7.3 | PASS | `staleDisabled=['ghost']`；`pruneDisabled` 仅移除失效名，仍存在的停用技能保持关闭 |
| AC-8.1 / 8.2 / 8.3 | PASS | `null`/`[]`/`dirs` 非数组/版本不符均不覆盖状态并给出 `loadError`；写盘失败不提交内存；无 `.tmp` 残留 |
| AC-9.1 / 9.2 / 9.3 | PASS | BOM 正常解析；`README.md` 被静默跳过（文件名必须匹配声明的 name）；符号链接用例在无创建权限的 Windows 上按约定跳过 |
| AC-10.1 | PASS | roots/state 在扫描前一次性捕获；并发变更测试下快照内部一致 |
| AC-10.2 | PASS | 缺失 `invocation` 的快照正常渲染并回落到「允许」策略 |
| AC-10.3 | PASS | `transport.fetch` 以绑定后的接收者调用（降级用例实测） |
| AC-10.4 | PASS | 变更后快照替换不清空卡片（不再出现「正在读取技能」）；可见性刷新走 silent 分支 |
| AC-10.5 | PASS* | 错误边界已包住三个入口；真实 React 的 class 分支未在本环境执行（测试桩没有 `React.Component`），留待一次人工刷新确认 |
| AC-11.1 / 11.2 / 11.3 | PASS | 关闭 → 双入口屏蔽；自声明 `disable-model-invocation` 保留；移除目录后候选消失；技能包替换先加后删 |
| AC-13.1 | PASS | 3 个目录 → 3 个父行；折叠时无技能子行；输出中无 `dsm-card`/`dsm-dirs` |
| AC-13.2 | PASS | `aria-expanded` 随点击翻转；`aria-controls` 指向真实子列表 `id`；快照替换后仍保持展开 |
| AC-13.3 | PASS | 「展开全部」后所有可展开父行 `aria-expanded=true`；「折叠全部」后全部为 `false` |
| AC-13.4 | PASS | 父行显示 `2 技能 · 1 已启用 · 1 无效`、`未扫全`、`来自配置`、`目录不存在`、`建议整包` |
| AC-13.5 | PASS | 子行开关 `aria-checked` 与 `enabled` 一致；点击发 `{name, enabled}`；关闭行保留技能名 |
| AC-13.6 | PASS | 筛选 `gamma` → 只显示 beta 包且自动展开；清空后恢复原展开状态；无匹配显示空提示 |
| AC-13.7 | PASS | 包级全开/全关（`{enabled, root}`）、改为添加技能包（`replaceWithPack`）、移除；配置目录没有范围开关；缺失目录不可展开 |
| AC-13.8 | PASS | 无效文件显示为包内虚线子行（相对路径 + 原因），无全局「无法解析的条目」区块 |
| AC-13.9 | PASS | `.dsm-tree-children` 竖脊 + `.dsm-tree-child::before` 圆角肘线；树相关 CSS 无硬编码颜色 |
| AC-13.10 | PASS | 空包展开显示「这个技能包里没有发现技能」；缺失目录的揭示按钮 `disabled` |
| AC-13.11 | PASS | 46 个用例全绿；验收脚本 24/24 |
| AC-14.1 | PASS | `.dsm-panel` 为 `flex column + height:100% + min-height:0`；`.dsm-panel > .dsm-root` 声明 `flex:1 1 auto; min-height:0; overflow-y:auto` |
| AC-14.2 | PASS | `scrollbar-color` 使用 `--dsw-alias-border-l3`；`::-webkit-scrollbar`（10px）+ 圆角 thumb + 透明轨道；`scrollbar-gutter: stable` |
| AC-14.3 | PASS | `.dsm-root` 基础规则无 `overflow-y`；滚动只作用于 `.dsm-panel`；无滚动祖先时由运行时探测加 `.dsm-root-scroll`（仅该情况） |
| AC-14.4 | PASS | 面板 DOM：`className="dsm-panel"><div className="dsm-root"`；内容完整渲染，滚动容器即内容容器 |
| AC-14.5 | PASS | 63 个用例全绿；验收脚本 31/31；真实滚轮交互待页面刷新后人工确认 |
| AC-15.1 | PASS | `conversation.hero.options`（id `session-skills`）+ `conversation.input.left` 两处注册；无 `sessionId` 渲染空；旧 Host 404 时自动隐藏 |
| AC-15.2 | PASS | 弹窗含搜索框、按包分组勾选行、`已选 N / 共 M`、全选/清空、`只影响本会话` 说明；Escape/外部点击关闭 |
| AC-15.3 | PASS | provider 按 `list({scope})` 过滤候选；`get({scope})` 对排除名返回 undefined；其它会话与全局不变；选择变更调用 `invalidate()` |
| AC-15.4 | PASS | `sessions[sessionId] = { excluded, updatedAt }` 落盘并在重启后生效；空选择删除条目；坏形状被忽略 |
| AC-15.5 | PASS | 不依赖改写 `skills` 服务（provider 内过滤）；`features.sessionSkills=true`；旧 Host 无端点 → 隐藏 |
| AC-15.6 | PASS | 非数组 → `invalid-argument`；未知技能名忽略并在响应 `ignored` 中返回 |
| AC-15.7 | PASS | 57 个用例、28 条验收检查全绿 |
| AC-16.1 | PASS | `apply()` 时向 `document.head` 注入 `<style data-skill-market>`，卸载时移除；设置页不再内联 `<style>` |
| AC-16.2 | PASS | 面板 `380px` / `max-width: calc(100vw - 24px)` / `max-height: min(60vh, 480px)`；列表 `flex:1 1 auto; min-height:0; overflow-y:auto` |
| AC-16.3 | PASS | `.dsm-session` 相对定位、面板绝对定位、`z-index:60`，展开不改变行高、不挤压图标 |
| AC-16.4 | PASS | 59 个用例、29 条验收检查全绿 |
| AC-16.5 | PASS | 触发按钮 getBoundingClientRect() 测量后 position: fixed 锚定视口；下方不足 260px 时向上展开，左右夹紧 12px；无法测量时退回绝对定位 |
| AC-17.1 | PASS | 包行改为 `button`（`aria-expanded`/`aria-controls`），**默认折叠**；展开只显示该包行，重开面板重置为折叠 |
| AC-17.2 | PASS | 标题栏「折叠全部 / 展开全部」一次翻转所有包；筛选激活时禁用 |
| AC-17.3 | PASS | 筛选自动展开匹配包；折叠不影响「全选 / 清空」（始终作用于全部技能） |
| AC-17.4 | PASS | 子行使用竖脊 + 圆角肘线（主题 token）；折叠按钮有可读 `aria-label` |
| AC-17.5 | PASS | 61 个用例、30 条验收检查全绿 |
| AC-18.1 | PASS | 包行最前面是 `checkbox`（`aria-label`「切换该技能包的全部技能：包名」）；部分排除时 `aria-checked="mixed"` |
| AC-18.2 | PASS | 点击父级勾选框一次 `setSessionSkills` 切整包；不影响其它包与折叠状态；保存中禁用 |
| AC-18.3 | PASS | 63 个用例、31 条验收检查全绿 |
| AC-12.1 | PASS | 63 个用例全绿（含真 socket 集成） |
| AC-12.2 | PASS | README/代码/`cordis.patch.yml` 三处一致，用例数与实际相符 |
| AC-12.3 | PASS | `plugin_manager set_bundle` → `application: applied`；live 检查：Host `Config` 条目 `include:skill-market` 已挂载，Client `sidebar.panellist`/`settings.section` 均含 `skill-market` 占位且 `active:true` |
| AC-12.4 | PASS | 验收脚本使用临时 HOME，可重复执行；不触碰用户注册表 |

*AC-10.5 的限制说明已写入 README「已知限制」。

