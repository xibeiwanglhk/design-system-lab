# Figma 插件：DSL Token Bridge（速查）

> 完整操作手册（含原理、验收点、排错）在 **[docs/04-Figma同步.md](../docs/04-Figma同步.md)**。
> 这个 README 只解决一件事：**怎么把它跑起来，出问题先看哪**。

---

## 1. 这个插件是干什么的

把 `tokens/tokens.json` 变成 Figma 里可维护的东西，并且能把 Figma 里的改动导回 JSON：

| 动作 | 结果 |
| --- | --- |
| 点 **① 生成变量与组件** | 建变量集合 `Design Tokens`（Light / Dark 两个模式）→ 142 个变量；建 `Button` 组件集（3 变体 × 4 状态 = 12 个）和 `FeedCard` 组件集（4 个状态） |
| 点 **② 从 Figma 导出变量 JSON** | 把 `Design Tokens*` 集合的本地变量还原成 `core` / `semantic` / `dark` 三个 set 的 Tokens Studio 兼容 JSON |

命名规则和 `scripts/build-tokens.mjs` 完全一致：

```
semantic.color.bg.surface-hover  →  CSS: --color-bg-surface-hover   Figma: color/bg/surface-hover
```

**只换分隔符**：Figma 的 `/` 换成 CSS 的 `-`，再加 `--`。

---

## 2. 文件清单

| 文件 | 作用 | 能不能改 |
| --- | --- | --- |
| [`plugin/manifest.json`](./plugin/manifest.json) | 插件声明（名字、入口、运行在 Figma Design） | 可以，改完要重新导入 |
| [`plugin/code.js`](./plugin/code.js) | 主线程逻辑：解析 token、建变量、建组件、导出 | 可以，改完先 `node --check` |
| [`plugin/ui.html`](./plugin/ui.html) | 插件面板（单文件，内联 CSS/JS，不联网） | 可以，改完重启插件 |

改完代码不用重新导入 manifest，只要**关掉插件面板再运行一次**（或在设置里打开 Hot reload）。

---

## 3. 安装（3 步，必须用桌面版）

> 官方文档明确写着：插件开发和测试需要 Figma 桌面版（浏览器版读不到你磁盘上的插件文件）。
> 依据：[Plugin Quickstart Guide](https://developers.figma.com/docs/plugins/plugin-quickstart-guide/)

1. 打开 **Figma 桌面版**并登录（免费 Starter 账号就行）。
2. 新建或打开一个 **Design 文件**。
3. 菜单 **Plugins → Development → Import plugin from manifest…** → 选择
   `figma/plugin/manifest.json`（这个文件，不是 `code.js`）。

导入成功后，菜单 **Plugins → Development** 里会多出一项 **DSL Token Bridge**。

> `manifest.json` 里没有写 `id`，这是故意的：本地开发插件不需要发布 ID，等真的发布到 Figma Community 时 Figma 才会分配。
> 也没有写 `"documentAccess": "dynamic-page"`：本地开发插件可以省，代价是第一次运行会看到一次
> “Loading n pages for plugin…” 的提示——**这是正常的**，不是报错。若以后要发布到 Community，
> 按官方 manifest 文档补上 `documentAccess: "dynamic-page"`（代码已全部使用异步 API，兼容）。

---

## 4. 运行

1. **Plugins → Development → DSL Token Bridge**。
2. 在项目根目录复制 tokens 全文：

   ```powershell
   Get-Content -Raw -Encoding utf8 tokens/tokens.json | Set-Clipboard
   (Get-Clipboard).Length   # 应该和源文件字符数一致
   ```

3. 粘贴进插件上方输入框 → 点 **① 生成变量与组件**。
4. 看日志出现 `变量处理完成…` `Button 组件集已生成…` `FeedCard 组件集已生成…`。
5. 想回写：点 **② 从 Figma 导出变量 JSON** → 看日志里的 dark 提示：
   - 日志说**已自动恢复 dark 段** → 可以**复制 → 覆盖 `tokens/tokens.json`**（先在分支上、先备份）。
   - 日志说 **dark 是空的** → **不要直接整文件覆盖**，按 [docs/04 的「2.18 免费版怎么安全回写」](../docs/04-Figma同步.md) 只合并改动的值。
   - 无论哪种，覆盖后都执行 `npm run tokens`，再刷新 `states.html?theme=dark` 确认暗色没坏。

**不要点插件外的空白处**去关面板：面板关掉后重新运行即可，变量和组件已经写进文件，不会丢。

---

## 5. 输出长什么样

生成的变量集合固定叫 **`Design Tokens`**（再次运行会复用，不会堆出 `Design Tokens 2`）。

- 付费/教育等支持多模式的套餐：集合里是 `Light` / `Dark` 两个模式。
- **免费 Starter**：Figma 只给 1 个模式，插件会捕获 `addMode` 的报错并**降级为单模式**，
  日志里明确写“已降级为单模式”。这是官方套餐限制，不是插件坏了
  （见 [Modes for variables](https://help.figma.com/hc/en-us/articles/15343816063383-Modes-for-variables)：多模式需要 Professional 及以上）。

导出的 JSON 有三个顶层 set：

```json
{
  "core":     { "color": { "gray": { "50": { "value": "#f8fafc", "type": "color" } } } },
  "semantic": { "color": { "bg": { "canvas": { "value": "{color.gray.50}", "type": "color" } } } },
  "dark":     { "color": { "bg": { "canvas": { "value": "{color.gray.950}", "type": "color" } } } }
}
```

- `core` 来自插件记在变量集合 pluginData 里的“哪些变量原本属于 core”。读不到记录时会退化成
  `core: {}` + 全部放进 `semantic`，并在日志里提醒。
- `dark` 只写“Dark 模式值和 Light 不一样”的变量。**免费版单模式**下会尝试从本文件
  「上次导入的 tokens.json」自动恢复 dark 段（日志会写明）；换文件、清过插件数据或第一次导出时，
  `dark` 仍可能是空对象 `{}`，这时按 docs/04 的 2.18 处理。
- **空 `core` / 空 `dark` 是故意保留的**：`scripts/build-tokens.mjs` 要求 tokens.json 里必须有
  `core` 和 `dark` 这两个 set，否则直接编译失败。

---

## 6. 出问题先看这里

| 症状 | 大概率原因 | 怎么办 |
| --- | --- | --- |
| 菜单里没有 **Import plugin from manifest…** | 用的是浏览器版 | 换成 Figma 桌面版 |
| 导入时提示 manifest 无效 | `manifest.json` 被改坏了 | `node -e "JSON.parse(require('fs').readFileSync('figma/plugin/manifest.json','utf8'))"` 先确认 JSON 合法 |
| 菜单里有插件，点了没反应 / 面板空白 | `ui.html` 语法错或文件名被改 | 确认文件名是 `ui.html`；`node --check figma/plugin/code.js`；重启桌面版 |
| 日志：`当前 Figma 套餐不支持多模式…` | 免费 Starter 只有 1 个模式 | 正常降级，Light 值都在；要 Dark 就得付费套餐 |
| 日志：`没有可用字体，跳过组件生成` | 四个候选字体一个都没加载成功 | 变量已经建好了；装 Inter 后重跑，或把 `code.js` 里 `FONT_FAMILIES` 换成你机器上有的字体族 |
| 日志：`创建变量 xxx 失败` | 同名变量类型冲突 / 没有编辑权限 | 删掉冲突变量再跑；确认你对文件有 edit 权限 |
| 组件集没合成（12 个组件散着） | `combineAsVariants` 失败（不在同一页 / 在实例里） | 日志会写原因；把散落的组件删掉，回到 `Page 1` 重跑 |
| 导出后 `npm run tokens` 报错 | 引用目标被删了 / dark 里有基础集没有的路径 | 看报错里点名的那条变量，删掉或补上基础 token |
| 免费版导出后暗色主题失效 | 单模式导出的 `dark` 是空对象 | 见 docs/04 的「2.18 免费版怎么安全回写」，别直接整文件覆盖 |

---

## 7. 已知限制（不是 bug）

1. **变量只能承载“值”**，不承载结构。你在 Figma 里挪一个卡片、加一个按钮，不会自动改 HTML/CSS。
2. **阴影是近似**：tokens 里的 `boxShadow` 是字符串，Figma 的 effect 是结构化数据，未做变量绑定；
   插件会把 `0 1px 2px 0 rgb(...)` 解析成近似 effect。切换 Dark 模式不会自动换阴影。
3. **导出类型靠命名推断**：Figma 变量只有 COLOR / FLOAT / STRING / BOOLEAN 四种，
   还原成 `spacing` / `borderRadius` / `fontSizes` 等要靠变量名前缀猜，导出后请人工确认一遍。
4. **字号可以绑定变量**：官方 `VariableBindableTextField` 包含 `fontSize` / `fontWeight` / `lineHeight` 等，
   插件已把字号、字重绑到 `font/size/body`、`font/weight/semibold`。
5. 插件**没有网络权限**（manifest 里 `networkAccess: none`），也不会把 tokens 传到任何地方。
6. **重复运行插件会再生成一套 Button / FeedCard 组件集**（变量会复用并更新，组件不会自动复用）；
   想保持文件干净，重跑前先把上一次生成的组件集删掉。

---

## 8. 相关文档

- 令牌命名与编译：[docs/01-设计令牌.md](../docs/01-设计令牌.md)
- 组件结构与状态类：[docs/02-组件实现.md](../docs/02-组件实现.md)
- 完整 Figma 流程 / 三条路线对比 / 手工兜底 / 排错：[docs/04-Figma同步.md](../docs/04-Figma同步.md)
- 官方参考：
  [figma.variables](https://developers.figma.com/docs/plugins/api/figma-variables/)、
  [VariableCollection](https://developers.figma.com/docs/plugins/api/VariableCollection/)、
  [setBoundVariable](https://developers.figma.com/docs/plugins/api/properties/nodes-setboundvariable/)、
  [combineAsVariants](https://developers.figma.com/docs/plugins/api/properties/figma-combineasvariants/)
