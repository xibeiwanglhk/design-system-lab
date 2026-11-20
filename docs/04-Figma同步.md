# 04 · Figma 同步：让设计令牌在 Figma 和代码之间往返

> **这一章解决什么问题**：你已经有一份 `tokens/tokens.json`，也有一套跑得起来的 HTML/CSS 组件。
> 现在要在 Figma 里得到**同一套令牌**和**同一套组件**，并且让设计师在 Figma 里改一个颜色之后，
> 这个改动能**安全地回到 GitHub 仓库**，再被自动编译、自动部署。
>
> **配套文件**：[`figma/plugin/manifest.json`](../figma/plugin/manifest.json) ·
> [`figma/plugin/code.js`](../figma/plugin/code.js) ·
> [`figma/plugin/ui.html`](../figma/plugin/ui.html) ·
> [`figma/README.md`](../figma/README.md)
>
> **前置**：`docs/03-Git与GitHub.md` 已经走完（仓库在 GitHub 上、Actions 能跑）。
> 如果还没做，先回去做完——本章最后的"提交 → Actions → Pages"依赖它。

---

## 目录

- [0. 先看清楚：这个闭环里到底同步了什么](#0-先看清楚这个闭环里到底同步了什么)
- [1. 三条路线怎么选（含 Code Connect）](#1-三条路线怎么选含-code-connect)
- [2. 主线 A：本仓库自带插件（推荐）](#2-主线-a本仓库自带插件推荐)
- [3. 路线 B：Tokens Studio（免费能做什么、什么要钱）](#3-路线-btokens-studio免费能做什么什么要钱)
- [4. 路线 C：html.to.design 做视觉对照 + Code Connect](#4-路线-chtmltodesign-做视觉对照--code-connect)
- [5. 手工兜底：插件跑不通时怎么在 Figma 里手动做](#5-手工兜底插件跑不通时怎么在-figma-里手动做)
- [6. 排错：12 个高频问题](#6-排错12-个高频问题)
- [7. 验收清单](#7-验收清单)
- [8. 官方链接合集](#8-官方链接合集)

---

## 0. 先看清楚：这个闭环里到底同步了什么

```
        tokens/tokens.json  ←──────────────┐
        （唯一真源，纯文本，能 diff）        │
                 │                        │
     node scripts/build-tokens.mjs        │ ② 从 Figma 导出变量 JSON
                 │                        │    （复制粘贴回来）
                 ▼                        │
        src/styles/tokens.css             │
        （CSS 自定义属性）                  │
                 │                        │
                 ▼                        │
        浏览器里的 index.html / states.html│
                 │                        │
                 │ ① 插件读取同一份 JSON   │
                 ▼                        │
        Figma：变量（color/bg/canvas…）    │
              组件集（Button / FeedCard）─┘
                 │
                 └─ 设计师在 Figma 改变量 → 导出 → 写回 tokens.json → 回到开头
```

**为什么真源必须是 `tokens.json`，而不是 Figma 文件？**

1. Figma 文件是云端二进制，`git diff` 看不出你改了哪个颜色；`tokens.json` 是纯文本，一行就是一个决定。
2. 编译需要"构建期就能读到的值"。CI 里跑 `node scripts/build-tokens.mjs --check` 能在合并前拦住"改了 token 忘了重新生成 CSS"。
3. Figma 只是众多消费方之一（还有 Web、iOS、Android）。真源放在中立格式里，谁都能读。

**这个闭环里，"能同步"和"不能同步"的边界**（先记住，后面不重复解释）：

| 东西 | 能自动同步吗 | 为什么 |
| --- | --- | --- |
| 令牌的**值**（颜色、间距、圆角、字号…） | ✅ 双向 | 它是数据，`tokens.json` ↔ Figma 变量一一对应 |
| 组件的**外观参数**（颜色、圆角、内边距） | ✅ 单向（JSON → Figma） | 插件在生成组件时把变量绑上去 |
| 组件的**结构 / 布局**（层级、宽高、间距关系） | ❌ | 变量只存"值"，不存结构；Figma 节点树和 DOM 树没有形式化映射 |
| **新增一个变体 / 新组件** | ❌ | 结构改动必须写 CSS（或先改 Figma 再手写 CSS 对齐） |
| Figma 里的**文字内容**（作者名、标题） | ❌ | 示例文案是占位符，不是令牌 |

想让"结构"也建立映射，只有一条路：**Code Connect**（把 Figma 组件映射到真实的代码片段），
但它也**不会**替你生成布局，只是让 Dev Mode 里显示"这个组件对应哪个代码组件"。见 [第 4 节](#4-路线-chtmltodesign-做视觉对照--code-connect)。

---

## 1. 三条路线怎么选（含 Code Connect）

| | **A. 本仓库自制插件** | **B. Tokens Studio** | **C. html.to.design** | **Code Connect** |
| --- | --- | --- | --- | --- |
| 本质 | 一个本地开发插件，读 `tokens.json` 生成变量 + 组件 | 成熟第三方插件，管理 token 并同步到 Git / Figma 变量 | 把网页"拍"成 Figma 可编辑图层 | 把 Figma 组件映射到代码组件 |
| 花钱吗 | **0 元**（免费 Starter 可用，只是没有多模式） | 免费版可用；Themes / 多文件同步 / 分支 / 颜色修饰要 Team 计划 | 免费 **10 次/月**（登录免费账号后每月续 10 次），PRO 才不限量 | 需要 **Professional 及以上** + **Full / Dev 席位** |
| 产出 | 变量集合 + `Button`（12 变体）+ `FeedCard`（4 状态）+ 可导回的 JSON | Figma 变量 / 样式 + Git 里的 token 文件 | 一次性图层快照（不可维护的组件） | 组件 ↔ 代码的映射关系（Dev Mode 里显示真实代码） |
| 离线可用 | ✅（插件声明 `networkAccess: none`） | ❌（要连 GitHub API） | ❌ | ❌（要连 Figma + 仓库） |
| 适合谁 | **本练习的主线**：想理解"令牌 → 变量 → 组件"的完整链路 | 团队已经在用 Tokens Studio，或需要多文件 / 分支工作流 | 做完设计后想对照"真实网页长什么样" | 已经有真实组件库（React/Vue…），想让设计稿直接指向代码 |
| 官方链接 | 本章第 2 节 | [GitHub sync](https://docs.tokens.studio/token-storage/remote/sync-git-github) · [付费功能](https://docs.tokens.studio/get-started/pro-licence) · [价格](https://tokens.studio/pricing) | [免费/PRO 说明](https://html.to.design/docs/pro-plan) · [插件页](https://www.figma.com/community/plugin/1159123024924461424) | [帮助中心](https://help.figma.com/hc/en-us/articles/23920389749655-Code-Connect) · [开发文档](https://developers.figma.com/docs/code-connect/) |

> ⚠️ **免费额度、套餐名称、每个集合能建几个模式，这类信息经常变**。
> 上面的数字是写这一章时从官方页面读到的，**请以官方当前页面为准**：
> [Figma 价格](https://www.figma.com/pricing/)、
> [Figma 套餐对比](https://help.figma.com/hc/en-us/articles/360040328273-Compare-Figma-plans-and-features)、
> [Tokens Studio 价格](https://tokens.studio/pricing)、
> [html.to.design 价格](https://html.to.design/docs/pro-plan)。

**建议的走法**：

1. **先走 A**（第 2 节）。它不需要任何付费功能，能让你把"令牌 → 变量 → 组件 → 导回 → CI"整条链路走通一遍。
2. 走通后再看 B：如果你以后要在真实项目里维护几百个 token，Tokens Studio 的 UI 和多文件同步更省事。
3. C 和 Code Connect 是"锦上添花"：C 用来做视觉走查，Code Connect 等你有真实组件库了再上。

---

## 2. 主线 A：本仓库自带插件（推荐）

**预计 30~45 分钟。全程只需要：Figma 桌面版 + 免费账号 + 本仓库。**

### 2.0 开始前的三个检查

在项目根目录打开 PowerShell（就是包含 `package.json`、`tokens/`、`src/` 的那个目录；下面所有命令都在这个目录里跑）：

```powershell
# 换成你自己的项目路径（也可以在资源管理器里进入目录后右键「在终端中打开」）
Set-Location "你的\项目路径\design-system-lab"
Get-Location                   # 确认输出就是这个项目目录，不是桌面/用户目录

node --version                 # 需要 >= 18（本项目零依赖，不需要 npm install）
node scripts/build-tokens.mjs  # 应该输出“✅ 已生成 src\styles\tokens.css”
```

**验收**：

- `node --version` 输出 `v18.x` 或更高。
- 编译命令**退出码为 0**，并且打印出 `token 总数：172（core 75 / semantic 67 / dark 30）` 和
  `CSS 变量：142 个` 这两类统计（token 条数 172、去重后的 CSS 变量 142，`dark` 是覆盖值所以不新增变量名）。
  如果你看到的数字不一样，说明 `tokens.json` 被改过——没关系，记住你自己的数字，后面核对时用它。

> 为什么先编译一次？因为插件和编译器读的是**同一份** `tokens.json`，
> 先确认它能编译，就能把"JSON 有问题"和"Figma 有问题"这两类故障分开。

---

### 2.1 安装并登录 Figma 桌面版

打开 <https://www.figma.com/downloads/>，下载 Windows 版并安装，然后用你的账号登录。

**为什么要桌面版？** 官方文档写得很直接：插件开发和测试需要桌面版，因为 Figma 要读取你**磁盘上**的插件文件；
浏览器版拿不到本地文件，所以菜单里根本不会出现 "Import plugin from manifest…"。
依据：[Plugin Quickstart Guide](https://developers.figma.com/docs/plugins/plugin-quickstart-guide/)。

**验收**：

- 桌面版能正常打开文件、左侧有图层面板。
- 菜单 **Plugins** 里能看到 **Development** 这一项（浏览器版看不到）。

---

### 2.2 新建一个 Design 文件（免费 Starter 够用）

桌面版首页 → **Create new** → **Design file**，命名成 `design-system-lab`。

**关于免费额度的两个事实**（以官方当前页面为准）：

- **变量本身所有套餐都能用**：`Guide to variables` 的 "Who can use this feature" 写的是 **All plans**。
- **变量"模式（modes）"是付费功能**：`Modes for variables` 写的是 Professional / Education / Organization / Enterprise；
  套餐对比表里 Starter 的 Variable modes 一栏是空的，Professional 每个集合最多 10 个模式。

所以免费账号能建变量、能用 Light 值，但**建不出 Dark 模式**。插件会在这一步自动降级（见 2.6）。

**验收**：文件打开了，画布上有一个 `Page 1`；左上角文件名是 `design-system-lab`。

> Starter 还有"1 个团队 / 1 个文件夹 / 3 个文件"的限制（套餐对比表）。
> 练习够用，但别把示例文件删了又建、建了又删，很容易撞上限。

---

### 2.3 导入本地插件

菜单：**Plugins → Development → Import plugin from manifest…**

在弹出的文件选择框里，选中：

```
design-system-lab\figma\plugin\manifest.json
```

（**选 `manifest.json`，不是 `code.js`，也不是 `ui.html`**。manifest 是入口，它在内部指向另外两个文件。）

**验收**：

- 菜单 **Plugins → Development** 下面出现 **DSL Token Bridge**。
- 如果这一步报错，先验证 manifest 是合法 JSON：

  ```powershell
  node -e "JSON.parse(require('fs').readFileSync('figma/plugin/manifest.json','utf8')); console.log('manifest OK')"
  ```

---

### 2.4 运行插件，先认识界面

菜单 **Plugins → Development → DSL Token Bridge**。

面板分三块：

1. **① 导入**：粘贴 `tokens.json`，点"① 生成变量与组件"。
2. **② 导出**：点"② 从 Figma 导出变量 JSON"，把变量还原成 JSON。
3. **日志**：每一步的结果都在这里，**出错先看日志**。

**验收**：

- 面板能打开，三个区域都在，日志里有一行 `就绪：先粘贴 tokens.json…`。
- 第一次运行时，画布上方可能出现一次 “Loading n pages for plugin…” —— **正常现象**。
  原因见 2.4 下方的小字。

> **为什么会有 "Loading n pages"？** 我们的 `manifest.json` **故意没有写** `"documentAccess": "dynamic-page"`。
> 本地开发插件可以省略它，代价是首次运行 Figma 会把整份文件加载进来、弹一次提示（**不影响功能**）。
> 官方对"新插件/发布插件"要求使用 `dynamic-page`（所有读取走 `*Async` 接口）；本插件代码已经全部使用异步 API，
> 以后要发布到 Figma Community 时，在 manifest 里补上 `"documentAccess": "dynamic-page"` 即可。
> 官方说明：[Plugin Manifest](https://developers.figma.com/docs/plugins/manifest/)。

---

### 2.5 复制 `tokens.json` 全文

**不要用记事本打开再 Ctrl+A**（可能带上 BOM 或改编码）。用 PowerShell 直接进剪贴板：

```powershell
Get-Content -Raw -Encoding utf8 tokens/tokens.json | Set-Clipboard

# 快速确认剪贴板里是 JSON，而不是空内容
$clip = Get-Clipboard -Raw
$clip.Length
$clip.TrimStart().StartsWith('{')
```

**验收**：

- `$clip.Length` 是一万多的数字（不是 0）。
- 第二行输出 `True`。
- 最终以插件日志里的 `解析成功：… 个变量` 为准；如果那里报 JSON 语法错，回到这一步重新复制。

---

### 2.6 粘贴并点"① 生成变量与组件"

把剪贴板内容粘到插件上方输入框（Ctrl+V），点 **① 生成变量与组件**，然后**等日志停下来**。

你会依次看到类似这样的行（数字以你的 `tokens.json` 为准）：

```
[信息] 解析成功：142 个变量（core 75 个，暗色覆盖 30 个），set：core / semantic / dark
[信息] 已创建变量集合 "Design Tokens"
[完成] 变量处理完成：新建 142，更新 0，跳过 0（共 142 个 token）
[信息] 组件示例文案使用字体：Inter（Regular / Semi Bold）
[完成] Button 组件集已生成：12 个变体（Variant × State）
[完成] FeedCard 组件集已生成：4 个状态
```

**免费 Starter 账号会多一行提醒**：

```
[提醒] 当前 Figma 套餐不支持多模式（免费版每个变量集合只有 1 个模式）：已降级为单模式，只写入 Light 值…
```

这是**预期行为**，不是失败：Figma 的 `collection.addMode()` 在免费套餐会抛错，插件捕获后继续，
只写 Light 值，其余照常完成。依据：[VariableCollection.addMode](https://developers.figma.com/docs/plugins/api/VariableCollection/)（"limited by the current file's pricing tier"）。

**验收**：

- 日志出现 `变量处理完成`，且"跳过"是 0（不是 0 也能继续，但要看清跳过的原因）。
- 日志出现 `Button 组件集已生成：12 个变体` 和 `FeedCard 组件集已生成：4 个状态`。
- 画布自动缩放到两个组件集（`Button` 在上、`FeedCard` 在下）。
- 如果按钮一直是"处理中…"不动：**关掉面板重新运行插件**（变量已写入文件，不会丢），再看日志。
- 如果整段报错，直接把日志文字复制出来对照[第 6 节](#6-排错12-个高频问题)。

---

### 2.7 核对变量命名（这是整个方案的地基）

左侧栏点 **Variables**（变量）图标，展开集合 **`Design Tokens`**。
你应该能看到一棵用 `/` 分层的树：`color` → `bg` → `canvas` 这样的层级。

**命名规则只有一条**（和 `scripts/build-tokens.mjs` 完全一致）：

> **去掉最外层 set 名，剩下的路径：CSS 用 `-` 连接并加 `--`，Figma 用 `/` 连接。**

| `tokens.json` 里的路径 | Figma 变量名 | CSS 变量名 |
| --- | --- | --- |
| `semantic.color.bg.canvas` | `color/bg/canvas` | `--color-bg-canvas` |
| `semantic.color.bg.surface-hover` | `color/bg/surface-hover` | `--color-bg-surface-hover` |
| `core.color.blue.600` | `color/blue/600` | `--color-blue-600` |
| `core.type.size.md` | `type/size/md` | `--type-size-md` |
| `semantic.font.size.body` | `font/size/body` | `--font-size-body` |
| `semantic.shadow.card` | `shadow/card` | `--shadow-card` |

> **最容易混的两个**：`core` 里的排版分组叫 **`type`**，所以是 `--type-size-md`（Figma：`type/size/md`）；
> 语义层的字号才叫 **`font`**，所以是 `--font-size-body`（Figma：`font/size/body`）。
> 它们指向同一个值（16px），但**是两个变量**，因为一个在 core、一个在 semantic。

**验收**：

- 在变量面板里能搜到 `color/bg/canvas`、`color/brand/bg`、`radius/control`、`space/card-padding`、`shadow/card`。
- 点开 `color/bg/canvas`，值显示 `#F8FAFC`，并且它**指向** `color/gray/50`（引用/别名，不是裸值）。
  这说明插件把 `{color.gray.50}` 解析成了 Figma 的变量别名，而不是抄了一份字面值。
- 集合里列名是 **Light**（免费版只有这一列）。付费账号还会有一列 **Dark**。

---

### 2.8 核对两个组件集

回到画布。你应该看到：

- **`Button`**：组件集（紫色虚线框），12 个变体，选中后在右侧能看到 **Variant** 和 **State** 两个属性。
  变体名形如 `Variant=Primary, State=Default`。
- **`FeedCard`**：4 个变体，属性是 **State**（`Default` / `Hover` / `Pressed` / `Disabled`），宽 560，
  里面有头像、作者/时间、标题、正文、两个标签、底部三个按钮（两个 ghost + 一个 primary）。

**验收**：

- 选中 `Button` 组件集，右侧属性面板里 `Variant` 有 3 个值、`State` 有 4 个值。
- 选中 `Button` 的 Primary/Default 变体，点它的背景色 → 颜色面板里显示的是**变量** `color/brand/bg`
  （不是 `#2563EB` 这种硬编码值）。
- `FeedCard` 的 Hover 变体和 Default 变体相比：阴影更深、边框更深；Disabled 变体没有阴影、整体发灰。
- 说明：**Hover 的 `translateY(-2px)` 上移在 Figma 里没有对应**（Figma 变体不做 transform），
  这是 CSS 交互细节，不要在 Figma 里找它。

---

### 2.9 验证"token 一致"：三方对照

选一个值，在三个地方确认它是同一个数：

| 你在哪看 | 怎么看 | 期望 |
| --- | --- | --- |
| `tokens/tokens.json` | 搜 `"brand"` → `"bg"` | `{ "value": "{color.blue.600}" }` |
| `src/styles/tokens.css` | 搜 `--color-brand-bg` | `--color-brand-bg: #2563eb;`（由 `color.blue.600` 解析而来） |
| Figma | 变量面板搜 `color/brand/bg` | 值是 `#2563EB`，并且它指向 `color/blue/600` |

**验收**：三处的值一致。如果 Figma 里显示的是别的颜色，八成是同一个变量名被覆盖了——查日志里的"更新"数量。

---

### 2.10 在 Figma 里改一个变量（制造一次"设计改动"）

1. 变量面板里点开 `color/brand/bg`，把值改成 `#7C3AED`（紫色），回车。
2. 回到画布看 `Button` 的 Primary 变体：背景应该立刻变紫。

> **别名的小坑**：`color/brand/bg` 的值现在是一个**别名**（显示成 `color/blue/600` 的胶囊）。
> 如果直接输入没反应，先点值左边那个"解除引用"的小图标，把它变回裸值再输入。
> 更省事的做法：直接改 `color/blue/600`，所有引用它的语义令牌（`color/brand/bg`、`color/text/link`…）
> 会一起变——这正是"别名"存在的意义。

**验收**：

- Button Primary 的 Default / Hover / Pressed 三个变体**都**变色了吗？
  —— **不会全变**。因为 `Hover` 用的是 `color/brand/bg-hover`（另一个变量）。
  这正好说明"状态是不同令牌"，也说明为什么不能只改一个值就指望所有状态跟着变。
- 你现在改的是 **Figma 里的副本**，仓库里的 `tokens.json` **还没变**。下一步才是把它写回去。

---

### 2.11 从 Figma 导出变量 JSON

点 **② 从 Figma 导出变量 JSON**，等日志出现 `导出完成：…`，结果会出现在下方文本框里。

导出结构是三个 set（和源文件一致）：

```json
{
  "core":     { "color": { "blue": { "600": { "value": "#2563eb", "type": "color" } } } },
  "semantic": { "color": { "brand": { "bg": { "value": "{color.blue.600}", "type": "color" } } } },
  "dark":     { "color": { "bg": { "canvas": { "value": "{color.gray.950}", "type": "color" } } } }
}
```

几个设计决定，看懂再往下走：

- **别名会被还原成 `{引用}`**。`color/brand/bg` 在 Figma 里是别名，导出就是 `{color.blue.600}`，
  所以编译出来的 CSS 依旧是"`--color-brand-bg` 引用 `--color-blue-600` 的值"，而不是两份独立字面量。
- **`core` 是靠 pluginData 还原的**。CSS 变量名里没有 set 名，光看名字分不出 core / semantic；
  插件在导入时把"哪些变量来自 core"记在了变量集合的 pluginData 里，导出时再读回来。
  这就是为什么**建议先导入、再导出**（否则读不到记录，会退化成全部放进 `semantic` + 空 `core`）。
- **`dark` 只写和 Light 不一样的值**。单模式（免费版）下，插件会尝试从本文件「上次导入的 tokens.json」
  自动恢复 dark 段（日志会写"已自动恢复 dark 段"）；如果是新文件/第一次导出，它仍可能是 `{}`，见 2.18。
- **空的 `core` / `dark` 必须保留**：`scripts/build-tokens.mjs` 要求这两个 set 存在，否则直接报
  `tokens.json 里不存在 set "core"`。这是"导出结果能直接编译"的前提。

**验收**：

- 文本框里是格式化好的 JSON（2 空格缩进），**顶层第一个 key 就是 `core`**。
- 日志里有类似 `导出完成：142 个变量（core 75 个，semantic 67 个），Dark 覆盖 30 个；跳过 0 个。`
  的统计（免费账号：若日志显示"已自动恢复 dark 段"，`Dark 覆盖` 也是 30；否则是 0）。
- 搜 `"brand"` 能看到 `"bg": { "value": "#7c3aed", ... }` —— 你刚才改的颜色在里面。

> **导出类型的局限（重要）**：Figma 变量只有 COLOR / FLOAT / STRING / BOOLEAN 四种类型，
> 而 Tokens Studio 有 `spacing` / `borderRadius` / `fontSizes` / `boxShadow` 等十几种。
> 插件只能**按变量名前缀猜**（`radius/` → `borderRadius`，`space/` → `spacing`，`shadow/` → `boxShadow`…）。
> 所以导出后请**扫一眼类型**，猜错了手动改掉——这不影响 CSS 变量名，只影响单位（比如 `spacing` 会加 `px`）。

---

### 2.12 安全回写仓库（一定先开分支）

**永远不要**在 `main` 上直接整文件覆盖。开一个分支，出问题一条命令就能回退。

```powershell
# 1) 确认工作区是干净的（有未提交改动就先提交或 stash）
#    如果这里报 "not a git repository"，先回 docs/03 完成 git init 和 remote 配置
git status

# 2) 开分支（名字随你，建议带上用途）
git switch -c figma/sync-brand-bg

# 3) 备份当前真源（万一导出文件不对，能立刻还原）
Copy-Item tokens/tokens.json tokens/tokens.backup.json -Force
```

> 备份文件只留在本地，**不要提交**：后面 `git add` 用的是精确路径，不会带上它；练完删掉即可。

然后用**下面两种方式之一**把导出的 JSON 写进 `tokens/tokens.json`：

**方式一（最稳，推荐）**：在插件里点"复制" → VS Code 打开 `tokens/tokens.json` → `Ctrl+A` → `Ctrl+V` → `Ctrl+S`。

**方式二（全键盘）**：

```powershell
# 从剪贴板读取，先验证是合法 JSON，再写文件（UTF-8 无 BOM）
$json = Get-Clipboard -Raw
try { $null = $json | ConvertFrom-Json; 'JSON 合法，可以写入' } catch { throw "剪贴板内容不是合法 JSON：$_" }
[System.IO.File]::WriteAllText((Join-Path $PWD 'tokens\tokens.json'), $json, [System.Text.UTF8Encoding]::new($false))
```

写完后立刻用编译器和 Git 双重校验：

```powershell
node -e "JSON.parse(require('fs').readFileSync('tokens/tokens.json','utf8')); console.log('tokens.json OK')"
git diff --stat
git diff tokens/tokens.json | Select-Object -First 40
```

**验收**：

- `tokens.json OK`。
- `git diff --stat` 只显示 `tokens/tokens.json`（还没有重新生成 CSS，所以 `tokens.css` 暂时没变）。
- `git diff` 里能看到 `#7c3aed` 这一处改动——**如果 diff 大得离谱**（整文件重写），说明格式化被改了：
  这是 `JSON.stringify` 造成的，内容仍然正确，但提交前建议用 VS Code 的格式化（Shift+Alt+F）统一一下风格。

> **免费版请先读 [2.18](#218-免费版怎么安全回写重要)**：单模式导出的 `dark` 是空的，
> 直接覆盖会让暗色主题失效。付费账号可以跳过那一节。

---

### 2.13 重新编译，本地看效果

```powershell
npm run tokens          # 等价于 node scripts/build-tokens.mjs
```

期望输出里 `本次内容有变化，记得提交 tokens.json 和 tokens.css`。

```powershell
npm run dev             # 等价于 node scripts/serve.mjs，默认 4173 端口
```

浏览器打开：

- <http://localhost:4173/> —— 信息流页面
- <http://localhost:4173/states.html> —— 组件状态矩阵 + 令牌总览
- <http://localhost:4173/states.html?theme=dark> —— 强制暗色（截图 / 对照用）

**验收**：

- 首页的 Primary 按钮变成紫色 `#7C3AED`。
- `states.html` 里 Button 的 Primary **Default** 变成紫色；**Hover / Pressed 仍然是原来的深蓝**——
  因为它们用的是 `color/brand/bg-hover` / `bg-active` 这两个独立令牌（这正是"状态即令牌"的意思）。
  想让三态一起变，就在 Figma 里把这两个变量也改掉，再导出一遍。
- `npm run tokens` 再跑一次，输出里**没有**"本次内容有变化"（说明 CSS 已是最新）。
- 按 `Ctrl+C` 停掉服务器。

---

### 2.14 提交并推送

```powershell
git add tokens/tokens.json src/styles/tokens.css
git commit -m "feat(tokens): 在 Figma 里把 color/brand/bg 调整为 #7c3aed"
git push -u origin figma/sync-brand-bg
```

**接下来二选一**：

- **走 PR（推荐，能看到 CI 拦截）**：在 GitHub 上开 Pull Request → 等 `Build tokens` 的 PR 检查变绿
  （PR 上只跑 `--check`，不写仓库）→ Merge 到 `main`。
- **直接推 main（练习环境可以）**：
  ```powershell
  git switch main
  git merge --ff-only figma/sync-brand-bg
  git push origin main
  ```

**验收**：

- `git log --oneline -3` 能看到你的提交。
- GitHub 网页上 `tokens/tokens.json` 里的 `color.brand.bg` 已经是 `#7c3aed`。

---

### 2.15 看 GitHub Actions 和 Pages

推到 `main` 后，仓库的 **Actions** 页会跑两个工作流（定义见 `.github/workflows/`）：

| 工作流 | 什么时候跑 | 干了什么 |
| --- | --- | --- |
| `Build tokens` | push 到 `main` 且改了 `tokens/**` | 跑 `node scripts/build-tokens.mjs`，把重新生成的 `tokens.css` **自动提交回 main**（提交信息带 `[skip ci]`） |
| `Deploy to GitHub Pages` | push 到 `main` 且改了 `src/**` 或 `tokens/**` | 现场生成令牌 → 把 `src/` 整个目录发布到 Pages |

**首次使用 Pages 必须先设置**：仓库 **Settings → Pages → Build and deployment → Source** 选 **GitHub Actions**，
否则 `configure-pages` 那一步会报错（`deploy-pages.yml` 的注释里也写了这一点）。

**验收**：

- `Build tokens` 和 `Deploy to GitHub Pages` 都是绿勾。
- 稍等 1~2 分钟，打开 `https://<你的用户名>.github.io/design-system-lab/`，
  按 `Ctrl+F5` 硬刷新，Primary 按钮是紫色。
- 如果页面还是旧的：先看 `Deploy to GitHub Pages` 是不是真的部署完了（deploy 步骤有 URL），
  再确认不是浏览器缓存（无痕窗口打开最快）。

---

### 2.16 回到 Figma，跑一遍"闭环验证"

1. 把**新的** `tokens/tokens.json` 再复制一次（`Get-Content -Raw ... | Set-Clipboard`）。
2. 重新运行插件（**Plugins → Development → DSL Token Bridge**）。
3. 点 **① 生成变量与组件**。

这次日志里应该是 **`更新 142`**（而不是 `新建 142`），因为变量集合已经存在，插件会复用并覆盖值。

**验收**：

- 日志：`复用已存在的变量集合 "Design Tokens"` + `变量处理完成：新建 0，更新 142，跳过 0`。
- 变量面板里 `color/brand/bg` 仍然是 `#7C3AED`（它现在是"从仓库读回来的值"）。
- 再点一次 **② 导出**，导出的 JSON 和 2.11 那次**内容一致**（这就是"往返一致"，round-trip）。
- 画布上会**多出第二套** `Button` / `FeedCard`：插件没有做"复用已有组件集"，
  第二次生成会再建两个组件集。删掉旧的那套、保留新生成的即可。
  这是已知限制（见 `figma/README.md` 的"已知限制"），也说明"组件是资产、变量是数据"。
- 如果日志出现"集合里还有 N 个变量不在本次 tokens.json 里"：那是上次导入留下的变量，
  插件不会删它们，但**导出时会把它们一起导出去**。想保持干净就先去变量面板里删掉，再重新导入。

> **为什么组件不做复用？** 因为组件是"结构"，一旦允许覆盖，就得处理"用户手动改过图层"的情况，
> 逻辑会复杂十倍。变量是数据，覆盖安全；组件是资产，重建更安全。这也再次说明：
> **自动同步的是值，不是结构。**

---

### 2.17 为什么"结构改动不会自动同步"

这是初学者最容易误解的地方，单独说清楚：

1. **变量只承载值**。Figma 的变量能绑到 fill、stroke、padding、cornerRadius、width/height 等字段，
   但它不描述"这个卡片里有一个头像、一个标题、一行标签"。
2. **Figma 节点树 ≠ DOM 树**。Figma 的 Frame 和 HTML 的 `<div>` 没有形式化对应关系；
   一个 Figma 组件可以被实现成 `<article>`，也可以是 `<li>` + 一堆 `<span>`。
3. **CSS 是运行时的真相**。布局由浏览器算，不是由 Figma 算。Figma 的 Auto layout 和 CSS Flex 相似但不等价
   （比如 `space-between` 的分配规则、最小宽度行为）。

所以：

- **只改颜色/间距/圆角/字号** → 走本章的闭环，自动同步。
- **改结构/加变体/调布局** → 先改 CSS（`src/styles/components.css`），再回 Figma 手动对齐；
  或者反过来，先在 Figma 试，再把结论写成 CSS。
- **想让"组件对应关系"也可追踪** → 上 Code Connect（需要付费套餐 + Dev/Full 席位），
  它解决的是"这个 Figma 组件对应哪个代码组件"，**不解决布局同步**。

---

### 2.18 免费版怎么安全回写（重要）

免费 Starter 只有 **1 个模式**，Figma 不会为暗色单独保存变量值。插件能做的补救是：
**从本文件「上次导入的 tokens.json」里把 dark 段原样恢复进导出结果**（存在 `figma.root` 的 pluginData 里，按文件隔离）。

所以导出后**先看日志**，分两种情况：

**情况 A：日志写「已自动恢复 dark 段（30 个 token）」** → 导出结果完整，可以按 2.12 正常回写、提交。
**情况 B：日志写「dark 是空的」** → 新文件、第一次导出，或插件数据被清过。此时直接整文件覆盖会：

- `npm run tokens` **仍然能编译通过**（因为 `dark` 这个 set 还在，只是空的）；
- 但 `[data-theme="dark"]` 里的覆盖**全部消失** → 切到暗色主题时，颜色会变回亮色值。

日志大概长这样：

```
[完成] 当前变量集合只有 1 个模式（Figma 免费版限制）：已从本文件「上次导入的 tokens.json」自动恢复 dark 段（30 个 token），导出结果可以安全覆盖 tokens.json。
[注意] 注意：当前变量集合只有 1 个模式，且没有上次导入的 dark 记录，导出结果里的 dark 是空的 —— 直接覆盖 tokens.json 会丢掉暗色主题。
```

UI 也不会放任你误操作：**情况 B 下点"复制"会弹确认框**，确认后还会在日志里再警告一次。
`npm run tokens` 在 dark 为空时也会打印一条 `⚠️ dark 集合为空` 的提示。

**情况 B 的三种安全做法，任选一种**：

**做法 1（最简单）：只搬"你改的那几个值"，不要整文件覆盖。**

导出只是给你看的。打开备份 `tokens/tokens.backup.json` 和导出结果对照，
在 VS Code 里只改 `tokens.json` 里对应的那**一行**（本例就是 `semantic.color.brand.bg`）。diff 干净、零风险。

**做法 2：覆盖后，把 `dark` 段从备份补回来。**

```powershell
node -e "const fs=require('fs');const p='tokens/tokens.json';const cur=JSON.parse(fs.readFileSync(p,'utf8'));const bak=JSON.parse(fs.readFileSync('tokens/tokens.backup.json','utf8'));if(!cur.dark||!Object.keys(cur.dark).length){cur.dark=bak.dark;fs.writeFileSync(p,JSON.stringify(cur,null,2)+'\n','utf8');console.log('已把 dark 段补回 tokens.json')}else{console.log('dark 段非空，无需处理')}"
npm run tokens
```

（注意：`JSON.stringify` 会把整个文件重排成 2 空格缩进，diff 会变大，但内容等价。）

**做法 3：升级套餐，让 Figma 真的有两个模式。**

- Figma Professional 起，每个变量集合最多 10 个模式（[套餐对比](https://help.figma.com/hc/en-us/articles/360040328273-Compare-Figma-plans-and-features)）；
  升级后重跑插件，会自动建出 `Dark` 模式，并把每个变量的 Light/Dark 值都写全，导出就完整了。
- 或者用 Tokens Studio 的 **Themes**（Team 计划）把多套值映射到多个模式，见[第 3 节](#3-路线-btokens-studio免费能做什么什么要钱)。

**验收**：

- 覆盖后 `npm run tokens` 通过。
- 打开 <http://localhost:4173/states.html?theme=dark>，暗色仍然是深色背景（不是白底）。
- 如果变白底了，说明 `dark` 丢了 —— 用做法 2 补回来。

---

## 3. 路线 B：Tokens Studio（免费能做什么、什么要钱）

> 这一节不是必做，是"第二条路"的速查。全程以官方文档为准：
> [GitHub sync 指南](https://docs.tokens.studio/token-storage/remote/sync-git-github) ·
> [付费功能说明](https://docs.tokens.studio/get-started/pro-licence) ·
> [多文件同步](https://docs.tokens.studio/token-storage/remote-multi-file-sync)。

### 3.1 免费版 vs Team 计划（官方口径）

| 能力 | 免费版 | Team 计划（付费） |
| --- | --- | --- |
| 同步 token 到任意 Git 提供方（GitHub / GitLab / Bitbucket / Azure DevOps） | ✅ | ✅ |
| **单文件**同步（一个 `tokens.json`） | ✅ | ✅ |
| **多文件 / 文件夹**同步（每个 Token Set 一个 JSON） | ❌（只能对已存在的文件夹做**只读**同步） | ✅ |
| 创建 / 切换 Git 分支 | ❌ | ✅ |
| Themes（多套值 ↔ 多个变量模式） | 只能**应用**别人做好的 Themes | ✅ 创建 / 编辑 / 删除 |
| 颜色修饰（Color modifiers） | 只能应用 | ✅ 创建 / 编辑 |
| 把变量导出到 Figma | ✅（按 Token Set 导出） | ✅（含 Themes → 多模式） |

依据：[Paid Figma plugin features](https://docs.tokens.studio/get-started/pro-licence)、
[Multi-file Sync (pro)](https://docs.tokens.studio/token-storage/remote-multi-file-sync)。
价格与套餐名可能变，**以 <https://tokens.studio/pricing> 当前页面为准**。

### 3.2 最小可用流程（免费版，单文件同步）

1. **安装插件**：Figma 里搜 Community 的 **Tokens Studio for Figma**，Run。
2. **导入现有 token**：在插件里找 **Load from file / Import**（不同版本位置略有差异，通常在 Tools 或 Tokens 页），
   选中 `tokens/tokens.json`；也可以直接把 JSON 粘进去。
   本仓库的 `core` / `semantic` / `dark` 会被识别成三个 **Token Set**。
   > 如果它按 W3C DTCG 格式解析报错，在 **Settings → Token Format** 里切到 Legacy（本项目是 Tokens Studio 经典格式）。
3. **建 GitHub PAT**：GitHub → Settings → Developer settings → Personal access tokens →
   勾 `repo`（classic）或给 Contents 读写（fine-grained）。**这个 token 等于密码，别提交进仓库。**
4. **在插件里加 Sync provider**：**Settings → Sync providers → Add new → GitHub**，填：
   - Name：随便起（如 `design-system-lab`）
   - Personal access token：上一步的 PAT
   - Repository：`<你的用户名>/design-system-lab`
   - Branch：`main`
   - **Token storage location**：填 **`tokens/tokens.json`**（**文件**模式，不是文件夹 —— 文件夹是多文件同步，要 Team 计划）
5. **首次同步**：Save 后插件会问 Push 还是 Pull。选 **Pull**（先把仓库里的拉下来，避免覆盖）。
6. **日常**：改 token → **Push**；别人改了仓库 → **Pull**。
7. **回到 CI**：push 到 `main` 后，`Build tokens` 会重新生成 `tokens.css` 并自动提交，
   `Deploy to GitHub Pages` 会重新部署 —— 和第 2.15 节完全一样。

**验收**：

- GitHub 上 `tokens/tokens.json` 的内容和你插件里看到的一致。
- Actions 里 `Build tokens` 绿勾，Pages 上的颜色更新了。
- 你能说清楚：**为什么这里必须选"文件"而不是"文件夹"**（文件夹 = 多文件同步 = Team 计划）。

### 3.3 什么时候该选 B 而不是 A

- 团队已经在用 Tokens Studio 管理几百个 token，需要它的 UI、Themes、分支工作流。
- 需要"设计师不碰 Git 也能提交 token"。
- 反过来：如果你只是想**理解**令牌怎么变成变量和组件，A 更透明（代码就在仓库里，随时能读、能改）。

---

## 4. 路线 C：html.to.design 做视觉对照 + Code Connect

### 4.1 用 html.to.design 把真实网页导进 Figma 对照

**用途**：做完 Figma 组件后，把**真实渲染**的 `states.html` 导进 Figma，并排放，
用肉眼核对"代码里的按钮"和"Figma 里的按钮"是不是一回事。**它产出的是一次性图层快照，不是可维护的组件库。**

步骤：

1. 本地起服务：`npm run dev`（或先部署到 Pages，用线上 URL）。
2. Figma 里运行 **html.to.design** 插件（[插件页](https://www.figma.com/community/plugin/1159123024924461424)）。
3. **Web** 标签里填：
   - 本地：`http://localhost:4173/states.html`（对照暗色再加 `?theme=dark`）
   - 线上：`https://<你的用户名>.github.io/design-system-lab/states.html`
4. 选视口宽度（桌面 1440 或和你设计稿一致），Import。
5. 把导入的图层放到 `FeedCard` 组件集旁边，逐项对照：圆角、内边距、字号、阴影、标签圆角。

**免费额度**（以官方页面为准）：**10 次免费导入**，登录免费的 ‹div›RIOTS ONE 账号后**每月 10 次**；
PRO 才不限量（约 $18/月，年付 $12/月）。依据：<https://html.to.design/docs/pro-plan>。

**验收**：

- Figma 里出现一个和 `states.html` 可视区域一致的 Frame。
- 你能指出至少 1 处"代码和 Figma 不一致"的地方（比如阴影更淡、行高不同），并说清是**令牌问题**还是**结构问题**。

> ⚠️ 本地 `localhost` 必须**先起服务**且插件能访问到（桌面版可以；某些环境下浏览器扩展方式更稳）。
> 如果一直转圈，先换线上 Pages URL 试。

### 4.2 Code Connect：适用条件 + 一句话说明

**一句话**：Code Connect 在 Dev Mode 的 Inspect 面板里，用你**真实组件库里的代码片段**替换 Figma 自动生成的示例代码，
让"设计稿 → 代码"这一步不再靠猜。

**适用条件**（官方 "Who can use this feature"）：

- Figma **Professional / Organization / Enterprise / Education / Government** 套餐；
- 需要 **Full 或 Dev 席位**；
- Professional 只能有 **1 个 active library + 1 个 active framework**（Organization 及以上没这个限制）。

依据：[Code Connect 帮助文档](https://help.figma.com/hc/en-us/articles/23920389749655-Code-Connect)、
[Code Connect 开发文档](https://developers.figma.com/docs/code-connect/)。

**它不做什么**：不同步布局、不生成 HTML、不替代本章的令牌闭环。它解决的是"这个 Figma 组件对应哪个代码组件"。

**什么时候考虑**：你已经有一个真实的前端组件库（比如 `Button.tsx`），并且团队用 Dev Mode 交接。
本练习阶段**不需要**它——先把令牌闭环走通。

---

## 5. 手工兜底：插件跑不通时怎么在 Figma 里手动做

> 目标不是"手动做一遍更酷"，而是**在你机器上插件真的跑不起来时，仍然能完成练习**。
> 手动做的东西和插件产物**命名必须一致**，否则以后想换回插件会冲突。

### 5.1 手动建变量集合

1. 左侧 **Variables** → **Create collection** → 命名 **`Design Tokens`**（一字不差）。
2. 免费版只有一列，点列头把它改名 **`Light`**。
   （付费版：右键列头 → Duplicate mode → 改名 `Dark`。）
3. 按 5.2 的表逐条 **Create variable**：先选类型（Color / Number / String），再填名字和值。
   - 名字里的 `/` 会**自动变成分组**（输入 `color/bg/canvas` 会得到 `color` → `bg` → `canvas`）。
   - 值是引用时：值输入框**右侧**有个"绑定变量"图标（四个小点），点它选目标变量（这样才是别名，不是抄值）。

### 5.2 变量命名表（最小可用的一组，51 条）

| Figma 变量名 | 类型 | Light 值 | 说明 |
| --- | --- | --- | --- |
| `color/white` | Color | `#ffffff` | |
| `color/gray/50` | Color | `#f8fafc` | 大量引用的基色 |
| `color/gray/100` | Color | `#f1f5f9` | |
| `color/gray/200` | Color | `#e2e8f0` | |
| `color/gray/300` | Color | `#cbd5e1` | |
| `color/gray/400` | Color | `#94a3b8` | `color/border/strong` 引用它 |
| `color/gray/500` | Color | `#64748b` | |
| `color/gray/600` | Color | `#475569` | |
| `color/gray/700` | Color | `#334155` | |
| `color/gray/800` | Color | `#1e293b` | |
| `color/gray/900` | Color | `#0f172a` | |
| `color/gray/950` | Color | `#020617` | |
| `color/blue/50` | Color | `#eff6ff` | |
| `color/blue/500` | Color | `#3b82f6` | |
| `color/blue/600` | Color | `#2563eb` | 品牌主色 |
| `color/blue/700` | Color | `#1d4ed8` | |
| `color/blue/800` | Color | `#1e40af` | |
| `color/bg/canvas` | Color | → `color/gray/50` | 别名 |
| `color/bg/surface` | Color | → `color/white` | 别名 |
| `color/bg/surface-hover` | Color | → `color/gray/100` | 别名 |
| `color/bg/surface-active` | Color | → `color/gray/200` | 别名 |
| `color/text/primary` | Color | → `color/gray/900` | 别名 |
| `color/text/secondary` | Color | → `color/gray/600` | 别名 |
| `color/text/muted` | Color | → `color/gray/500` | 别名 |
| `color/text/on-brand` | Color | → `color/white` | 别名 |
| `color/border/subtle` | Color | → `color/gray/200` | 别名 |
| `color/border/default` | Color | → `color/gray/300` | 别名 |
| `color/border/strong` | Color | → `color/gray/400` | 别名 |
| `color/brand/bg` | Color | → `color/blue/600` | 别名 |
| `color/brand/bg-hover` | Color | → `color/blue/700` | 别名 |
| `color/brand/bg-active` | Color | → `color/blue/800` | 别名 |
| `color/disabled/bg` | Color | → `color/gray/100` | 别名 |
| `color/disabled/border` | Color | → `color/gray/200` | 别名 |
| `color/disabled/text` | Color | → `color/gray/400` | 别名 |
| `color/tag/bg` | Color | → `color/blue/50` | 别名 |
| `color/tag/text` | Color | → `color/blue/700` | 别名 |
| `radius/control` | Number | `10` | |
| `radius/surface` | Number | `16` | |
| `radius/pill` | Number | `9999` | Figma 会自动夹到高度的一半 |
| `space/4` | Number | `16` | |
| `space/card-padding` | Number | `20` | |
| `space/stack-sm` | Number | `8` | |
| `space/stack-md` | Number | `12` | |
| `size/control-height-md` | Number | `40` | |
| `size/avatar` | Number | `40` | |
| `font/size/meta` | Number | `14` | |
| `font/size/body` | Number | `16` | |
| `font/size/title` | Number | `18` | |
| `font/weight/semibold` | Number | `600` | |
| `font/leading/body` | Number | `1.5` | |
| `shadow/card` | String | `0 1px 2px 0 rgb(15 23 42 / 0.06), 0 8px 24px -12px rgb(15 23 42 / 0.16)` | 字符串，Figma 不能直接当 effect 用 |

> 只做**最小可用**就先建这 51 条；插件版是 142 条，多出来的是完整色阶和 dark 覆盖。

### 5.3 手动建 `Button` 组件集（12 变体）

1. 画一个 Frame：**Auto layout 横向**、左右 padding `16`、上下 padding `0`、**高度固定 `40`**、圆角 `10`、填充 `color/brand/bg`。
2. 放一个文字图层 `Button`，字号 `16`、字重 `Semi Bold`、颜色 `color/text/on-brand`。
3. 选中 Frame → 右键 **Add variant**：Figma 会把它变成组件集，并自动给出一个属性 **`Variant`**（值 `Default`）。
4. 在右侧的变体面板里把 `Variant` 的值改成 `Primary`；再点 **+** 新增属性 **`State`**，值为 `Default`。
   之后每点一次 **+** 或右键 **Duplicate**，都会复制出一个变体，把两个属性的值填成需要的组合。
5. 凑满 **3 × 4 = 12** 个变体（`Primary` / `Secondary` / `Ghost` × `Default` / `Hover` / `Pressed` / `Disabled`），
   把组件集改名为 **`Button`**。
   > 变体名会显示成 `Variant=Primary, State=Default` —— Figma 靠这个逗号格式识别属性，**不要手工改成别的写法**。
   > 另一种做法：先做 12 个独立组件，名字直接写成 `Variant=Primary, State=Default`，全选后右键 **Combine as variants**。
6. 按下面的表调每个变体的填充/文字/描边（都用 5.2 里建好的变量绑定）：

| 变体 | State | 背景 | 文字 | 描边 |
| --- | --- | --- | --- | --- |
| Primary | Default | `color/brand/bg` | `color/text/on-brand` | 无 |
| Primary | Hover | `color/brand/bg-hover` | `color/text/on-brand` | 无 |
| Primary | Pressed | `color/brand/bg-active` | `color/text/on-brand` | 无 |
| Primary | Disabled | `color/disabled/bg` | `color/disabled/text` | `color/disabled/border` |
| Secondary | Default | `color/bg/surface` | `color/text/primary` | `color/border/default` |
| Secondary | Hover | `color/bg/surface-hover` | `color/text/primary` | `color/border/strong` |
| Secondary | Pressed | `color/bg/surface-active` | `color/text/primary` | `color/border/strong` |
| Secondary | Disabled | `color/disabled/bg` | `color/disabled/text` | `color/disabled/border` |
| Ghost | Default | 透明 | `color/text/secondary` | 无 |
| Ghost | Hover | `color/bg/surface-hover` | `color/text/secondary` | 无 |
| Ghost | Pressed | `color/bg/surface-active` | `color/text/primary` | 无 |
| Ghost | Disabled | `color/disabled/bg` | `color/disabled/text` | `color/disabled/border` |

**绑定变量怎么做**：选中图层 → 右侧 Fill / Stroke / Auto layout padding / 圆角输入框 → 点输入框**右侧的变量图标**
（四个小点）→ 选对应变量。绑定成功后，值旁边会显示变量名而不是十六进制。

**验收**：选中不同变体，右侧显示的填充名字是 `color/brand/bg` 这类变量名；改 `color/brand/bg` 的值，Primary 三态里只有 Default 跟着变。

### 5.4 手动建 `FeedCard` 组件集（4 状态）

1. Frame：宽 `560`、**纵向 Auto layout**、padding `20`、圆角 `16`、填充 `color/bg/surface`、
   描边 1px `color/border/subtle`、阴影用 `shadow/card` 的近似值（Figma 的 Drop shadow：`0 1 2 0` + `0 8 24 -12` 两层）。
2. 头部（横向 Auto layout，`Space between`）：
   - 左：`40×40` 圆形 + 纵向两行文字
     - 作者：`Alex Chen`，`14` / Semi Bold / `color/text/primary`
     - 时间：`2h ago`，`12` / `color/text/muted`
   - 右：`···`，`color/text/muted`
3. 标题：`Feed card title`，`18` / Semi Bold / `color/text/primary`。
4. 正文：`16` / Regular / `color/text/secondary` / 行高 `150%`，设置为**填充容器宽度**。
5. 标签行（横向，间距 `8`）：两个标签，各自 padding `4×10`、圆角 `9999`、
   填充 `color/tag/bg`、文字 `12` / `color/tag/text`。
6. 底部（横向，`Space between` / 右对齐）：三个 `Button` 实例 —— Ghost（Read more）、Ghost（Save）、Primary（Follow）。
7. 选中整个卡片 → **Add variant**：会自动变成组件集并带一个属性（默认叫 `Variant`）。
   把这个属性**改名为 `State`**（或删掉它、新建 `State`），值设成 `Default`。
8. 用变体面板的 **+** / 右键 **Duplicate** 复制出 4 个值：`Default` / `Hover` / `Pressed` / `Disabled`，
   然后按表调差异：

| State | 填充 | 描边 | 阴影 | 文字 |
| --- | --- | --- | --- | --- |
| Default | `color/bg/surface` | `color/border/subtle` | `shadow/card` 近似 | 正常 |
| Hover | `color/bg/surface` | `color/border/default` | `shadow/card-hover` 近似 | 正常 |
| Pressed | `color/bg/surface` | `color/border/default` | 回到 `shadow/card` 近似 | 正常 |
| Disabled | `color/disabled/bg` | `color/disabled/border` | 无 | `color/disabled/text` |

9. 把组件集命名为 **`FeedCard`**（只留 `State` 一个属性、4 个值）。

**验收**：`FeedCard` 只有 **1 个**变体属性 `State`、4 个值；卡片宽度 560；Hover 的阴影明显比 Default 深。

### 5.5 手动"导出"

- **不推荐**用 Figma 原生的 **Export modes**（右键集合 → Export modes）来替代插件导出：
  它导出的是 **Figma 自己的变量 JSON 格式**，字段名不是本项目的 `value` / `type`，
  **`build-tokens.mjs` 读不了**。
- 手工导出请照插件格式**手写**三个 set，或者干脆：**只把你在 Figma 里改的那一个值，手写回 `tokens.json`**。
  练习阶段这样最省事，也最不容易出错。

---

## 6. 排错：12 个高频问题

> 通用顺序：**先看插件日志** → 再看 Figma 控制台（Plugins → Development → Open console）→ 最后才怀疑代码。

| # | 症状 | 原因 | 解决 |
| --- | --- | --- | --- |
| 1 | 菜单里没有 **Import plugin from manifest…** | 用的是浏览器版 Figma | 换桌面版（官方要求） |
| 2 | 导入 manifest 报错 / 没反应 | `manifest.json` JSON 语法坏了，或选错了文件 | `node -e "JSON.parse(require('fs').readFileSync('figma/plugin/manifest.json','utf8'))"`；确认选的是 manifest 不是 code.js。极少数 Figma 版本会要求 `id` 字段：用 **Plugins → Development → New plugin** 生成一个模板，把模板 manifest 里的 `id` 抄到本仓库的 manifest 里再导入 |
| 3 | 运行插件报语法错误 / `Cannot find module` | 改过 `code.js` | 先 `node --check figma/plugin/code.js`，再重新运行插件 |
| 4 | 插件面板一片空白 | `ui.html` 被改名或语法错 | 确认文件名是 `ui.html`；改过内联脚本的话，把 `<script>` 里那段抽出来单独 `node --check`；还不行就重启桌面版、重新导入 manifest |
| 5 | 出现 “Loading n pages for plugin…” | manifest 没写 `documentAccess` | 正常现象，等它加载完 |
| 6 | 日志：`当前 Figma 套餐不支持多模式…` | 免费 Starter 只有 1 个模式 | 正常降级；要 Dark 模式需付费套餐 |
| 7 | 变量面板出现两个 **Design Tokens** | 你手动建过同名集合，或改过集合名 | 删掉多余的那个，重跑插件（插件只复用**同名**集合） |
| 8 | 日志：`没有可用字体，跳过组件生成` | Inter / PingFang SC / 微软雅黑 / Noto Sans SC 都没加载成功 | 变量已建好；装 Inter 后重跑，或改 `code.js` 里的 `FONT_FAMILIES` |
| 9 | 组件没合成，12 个组件散在画布上 | `combineAsVariants` 失败（不在同一页 / 组件在实例里） | 删掉散落的组件，回到 `Page 1` 重跑；日志里有具体错误 |
| 10 | `npm run tokens` 报"引用了不存在/未定义的 token" | 覆盖 tokens.json 时删掉了被引用的变量 | 用 `git diff` 找回；或把被引用的 token 补回 `core` |
| 11 | `npm run tokens` 报 `tokens.json 里不存在 set "core"`（或 `"dark"`） | 你手工删了空 set，或用了别的工具导出 | 保留 `"core": {}` / `"dark": {}` 这两个空对象（编译器要求它们存在） |
| 12 | 改了 Figma 变量，网页没变 | 忘了重新编译 / 忘了硬刷新 / 改的是 Dark 值 | `npm run tokens` → `Ctrl+F5`；确认当前主题；确认改的是你要的那个变量（`bg` 还是 `bg-hover`） |

**补充：导出后编译失败（引用 / 类型不匹配）怎么定位**

编译器会点名，例如：

```
❌ 令牌编译失败：
   - 找不到引用目标 {color.gray.999}
```

三种典型原因：

1. **引用目标被删了**：在 Figma 里删了某个变量，但别的变量还在引用它。→ 要么恢复目标，要么删掉引用它的那条。
2. **`dark` 里出现了基础集没有的路径**：你在 Figma 里新加了一个只在 Dark 里存在的变量。
   → 编译器要求"暗色 token 必须在 core/semantic 有同路径"，给它补一个 Light 版本。
3. **类型被推断错**：插件是按变量名前缀猜的，猜不到就退回 `number`。
   比如你在 Figma 里新建了一个 `padding/lg`，导出会变成 `"type": "number"`，CSS 里就少了 `px`。
   → 打开 `tokens.json` 把 `"type": "number"` 改成 `"type": "spacing"`（不影响变量名，只影响单位）。

---

## 7. 验收清单

- [ ] 我能用 **Figma 桌面版**打开 Design 文件，并在 **Plugins → Development** 里看到 `DSL Token Bridge`
- [ ] 我把 `tokens.json` 粘进插件并点"① 生成变量与组件"，日志出现 `变量处理完成`（跳过 0 或已看清原因）
- [ ] 变量集合 `Design Tokens` 里能搜到 `color/bg/canvas`、`color/brand/bg`、`radius/control`、`space/card-padding`，并且我能说出它们对应的 CSS 变量名（比如 `color/bg/canvas` ↔ `--color-bg-canvas`）
- [ ] 画布上有 `Button` 组件集（12 变体，属性 `Variant` + `State`）和 `FeedCard` 组件集（4 状态，宽 560）
- [ ] 我能指出按钮/卡片上至少 3 处"填充绑定的是变量而不是硬编码颜色"
- [ ] 我在 Figma 里把 `color/brand/bg` 改成别的颜色，并成功用"② 导出"拿到含新值的 JSON
- [ ] 我把导出的 JSON 写回了 `tokens/tokens.json`（在分支上做，且 `node -e "JSON.parse(...)"` 通过）
- [ ] `npm run tokens` 成功，本地 `http://localhost:4173/` 的颜色跟着变了
- [ ] 改动已 commit + push，GitHub 上 `Build tokens` 和 `Deploy to GitHub Pages` 都是绿勾
- [ ] Pages 线上地址硬刷新后是新颜色
- [ ] 我重新跑了一次插件，日志显示 `更新 142`（而不是新建），说明往返一致（round-trip）
- [ ] 我知道**结构/布局改动不会自动同步**，并说得清原因（变量只承载值）

---

## 8. 官方链接合集

**Figma 插件开发**

- 插件快速开始（"需要桌面版"的出处）：<https://developers.figma.com/docs/plugins/plugin-quickstart-guide/>
- 插件 manifest 字段：<https://developers.figma.com/docs/plugins/manifest/>
- `figma.variables` API：<https://developers.figma.com/docs/plugins/api/figma-variables/>
- `VariableCollection`（`addMode` / `renameMode` / 套餐限制）：<https://developers.figma.com/docs/plugins/api/VariableCollection/>
- `Variable`（`setValueForMode` / `valuesByMode`）：<https://developers.figma.com/docs/plugins/api/Variable/>
- `setBoundVariable` 与可绑定字段：<https://developers.figma.com/docs/plugins/api/properties/nodes-setboundvariable/> ·
  <https://developers.figma.com/docs/plugins/api/VariableBindableNodeField/>
- `combineAsVariants`：<https://developers.figma.com/docs/plugins/api/properties/figma-combineasvariants/>
- `loadFontAsync` / 处理文字与字体：<https://developers.figma.com/docs/plugins/api/properties/figma-loadfontasync/> ·
  <https://developers.figma.com/docs/plugins/working-with-text/>
- 变量使用指南：<https://developers.figma.com/docs/plugins/working-with-variables/>

**Figma 功能与套餐（易变，以当前页面为准）**

- 变量总览（All plans）：<https://help.figma.com/hc/en-us/articles/15339657135383>
- 变量模式（Professional+）：<https://help.figma.com/hc/en-us/articles/15343816063383>
- 套餐对比：<https://help.figma.com/hc/en-us/articles/360040328273-Compare-Figma-plans-and-features>
- 价格：<https://www.figma.com/pricing/>

**Tokens Studio**

- GitHub 同步（单文件 / 文件夹、PAT）：<https://docs.tokens.studio/token-storage/remote/sync-git-github>
- 付费功能边界：<https://docs.tokens.studio/get-started/pro-licence>
- 多文件同步（Team）：<https://docs.tokens.studio/token-storage/remote-multi-file-sync>
- 价格：<https://tokens.studio/pricing>

**html.to.design / Code Connect**

- html.to.design 免费与 PRO：<https://html.to.design/docs/pro-plan>
- html.to.design 插件页：<https://www.figma.com/community/plugin/1159123024924461424>
- Code Connect 帮助（套餐 + 席位要求）：<https://help.figma.com/hc/en-us/articles/23920389749655-Code-Connect>
- Code Connect 开发文档：<https://developers.figma.com/docs/code-connect/>

**GitHub**

- GitHub Pages 文档：<https://docs.github.com/en/pages>
- GitHub Actions 文档：<https://docs.github.com/en/actions>

---

**上一章**：[03 · Git 与 GitHub](./03-Git与GitHub.md)　
**下一章**：[05 · 接入网页](./05-接入网页.md)　
**排错总表**：[06 · 进阶与排错](./06-进阶与排错.md)
