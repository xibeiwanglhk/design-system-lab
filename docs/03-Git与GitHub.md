# 03 · Git 与 GitHub：从本地仓库到线上 Pages

> 适用对象：会基本 `git add` / `git commit` / `git push`，但没独立走过「建仓库 → 推送 → CI → 部署 → 分支 PR」完整流程的人。
> 预计用时：60~90 分钟。
> 本文所有命令都是 **Windows PowerShell** 语法，默认在项目根目录执行：
> `C:\Users\Administrator\Desktop\deepseek harness练习\全栈练习\design-system-lab`
> 文中出现 `<你的用户名>` 的地方，替换成你自己的 GitHub 用户名（例如 `octocat`）。

学完这一篇，你应该能做到：

- 本地项目变成干净的 Git 仓库，提交历史可读；
- 推到 GitHub 后，两个 GitHub Actions 工作流自动跑起来；
- GitHub Pages 上能打开 `index.html` 和 `states.html`；
- 会走一遍分支 + Pull Request，知道 CI 在 PR 上检查什么；
- 出错时能按「现象 → 原因 → 处理」自己排查常见问题。

---

## 0. 先看懂：这个项目的 CI/CD 在做什么

### 0.1 两个工作流

仓库里有两个工作流文件，分工不同：

| 文件 | 显示名（Actions 页面看到的） | 触发条件 | 做什么 |
| --- | --- | --- | --- |
| `.github/workflows/build-tokens.yml` | `Build tokens` | push 到 `main`，且改动 `tokens/**`、`scripts/build-tokens.mjs`、本工作流文件；同路径的 pull_request | 保证 `tokens.json` 改了以后 `tokens.css` 是重新生成过的 |
| `.github/workflows/deploy-pages.yml` | `Deploy to GitHub Pages` | push 到 `main`，且改动 `src/**`、`tokens/**`、`scripts/build-tokens.mjs`、本工作流文件；也可以手动 `workflow_dispatch` | 生成最新令牌，把 `src/` 整个目录发布到 GitHub Pages |

关键差异，先记住这一句：

> **PR 上只校验，不写仓库；push 到 main 才自动提交生成物。**

`Build tokens` 在两种事件下的行为：

- `pull_request`：执行 `node scripts/build-tokens.mjs --check`。如果提交里的 `tokens.css` 和 `tokens.json` 对不上（过期），这一步退出码为 1，PR 变红，合不进去。
- `push`：执行 `node scripts/build-tokens.mjs` 真正生成一次；如果生成结果和仓库里的 `src/styles/tokens.css` 不一样，用 `stefanzweifel/git-auto-commit-action@v5` 把新文件提交回 `main`，提交信息是：
  `chore(tokens): 重新生成 tokens.css [skip ci]`

### 0.2 一次 push 的完整链路

```text
你改了 tokens/tokens.json 并 push 到 main
        │
        ├─ 命中 tokens/** ──▶ Build tokens
        │                       └─ push：node scripts/build-tokens.mjs
        │                          └─ tokens.css 有变化 → 自动提交回 main
        │
        └─ 同时命中 tokens/** ──▶ Deploy to GitHub Pages
                                   ├─ node scripts/build-tokens.mjs（部署前现场再生成一次）
                                   ├─ 上传 src/ 作为站点根目录
                                   └─ 部署 → https://<你的用户名>.github.io/design-system-lab/
```

你只改 `src/` 下的样式或页面时，只有 `Deploy to GitHub Pages` 会跑；只改 `docs/` 时两个都不跑，这是 `paths` 过滤的正常行为。

### 0.3 为什么自动提交不会死循环

这是初学者最常问的问题。这个设计有三层保险：

1. **路径过滤不含 `src/**`。** `Build tokens` 的 `push.paths` 只有 `tokens/**`、`scripts/build-tokens.mjs`、工作流文件自己；而自动提交只改 `src/styles/tokens.css`，这个提交本身不满足触发条件。
2. **`GITHUB_TOKEN` 推送的提交不会触发新的 workflow run。** 这是 GitHub 的既定行为：用仓库自带的 `GITHUB_TOKEN` 执行 push，不会连锁触发其他工作流（`workflow_dispatch`、`repository_dispatch` 除外）。
   官方说明：<https://docs.github.com/en/actions/tutorials/authenticate-with-github_token>
3. **提交信息带 `[skip ci]`。** 即使你以后改成用自己的 PAT 推送、触发了工作流，GitHub 也会因为提交信息里的跳过关键字而不跑这次 CI。
   官方说明：<https://docs.github.com/en/actions/how-tos/manage-workflow-runs/skip-workflow-runs>

所以：**不会死循环，也不会出现「机器人提交触发机器人再提交」的滚雪球。**

### 0.4 自动提交和 Pages 部署的关系（容易忽略）

第 2 条保险有个副作用：**机器人那次提交不会触发 `Deploy to GitHub Pages`**。那线上会不会用到旧的 `tokens.css`？

不会。因为 `deploy-pages.yml` 在打包之前自己执行了一次：

```yaml
- name: 生成最新设计令牌
  run: node scripts/build-tokens.mjs
```

它用的是**触发这次部署的那个提交里的 `tokens.json`**，现场生成 CSS 再上传 `src/`。所以即使仓库里的 `tokens.css` 还没被机器人提交，线上也已经是新令牌。这就是为什么部署工作流里要重复跑一次生成命令，而不是直接上传仓库里的文件。

### 0.5 站点根目录是 `src/`，路径必须用相对路径

`deploy-pages.yml` 上传的是 `./src`，不是仓库根目录。所以：

- 站点地址是 `https://<你的用户名>.github.io/design-system-lab/`；
- `src/index.html` 里的 `./styles/tokens.css` 会解析成
  `https://<你的用户名>.github.io/design-system-lab/styles/tokens.css`，正确；
- 如果写成绝对路径 `/styles/tokens.css`，会解析成
  `https://<你的用户名>.github.io/styles/tokens.css`，**404**。

本项目现有页面已经全部使用 `./styles/...`、`./app.js`、`./states.html` 这样的相对路径。你以后加页面时保持同样的写法即可；如果把 HTML 放进子目录，路径要跟着多退一层（例如 `../styles/tokens.css`）。

### 0.6 本地命令 vs CI 命令

| 场景 | 命令 | 说明 |
| --- | --- | --- |
| 日常本地生成 | `npm run tokens` | 等价于 `node scripts/build-tokens.mjs`，见 `package.json` 的 `scripts.tokens` |
| 日常本地校验 | `npm run tokens:check` | 等价于 `node scripts/build-tokens.mjs --check` |
| CI 里 | `node scripts/build-tokens.mjs` / `... --check` | 直接调用脚本，不经过 npm，少一层依赖 |

本项目是零依赖的：**不需要 `npm install`**。`npm run tokens` 能用，只是因为 Node.js 自带 npm，能读 `package.json` 里的脚本；它不会下载任何东西。CI 里刻意用 `node` 直接跑，好处是以后改 `package.json` 的脚本名不会悄悄改变 CI 行为。

---

## 1. 前置检查与一次性配置

### 1.1 检查 node 与 git

在项目根目录打开 PowerShell（在资源管理器地址栏输入 `powershell` 回车也可以），执行：

```powershell
node --version
git --version
```

验收标准：

- `node --version` 输出 `v18` 或更高（本项目 `package.json` 要求 `>=18`，建议 20/22 LTS）；
- `git --version` 输出 `git version 2.28` 或更高（`git init -b main` 需要 2.28+；本文用到的 `git switch` / `git restore` 需要 2.23+）。

如果提示「无法将 node 识别为 cmdlet」：

- Node.js 下载：<https://nodejs.org/zh-cn/download>（选 LTS）；
- Git for Windows 下载：<https://git-scm.com/download/win>（安装时保持默认选项，会顺带装 Git Credential Manager）。

装完必须**关闭当前终端重新打开**，PATH 才会刷新。

### 1.2 配置提交身份（一次性）

Git 每次提交都要记录作者。先看有没有配过：

```powershell
git config --global user.name
git config --global user.email
```

两条都有输出就跳过本节；任意一条为空，执行（换成你的信息）：

```powershell
git config --global user.name "你的名字"
git config --global user.email "你的邮箱@example.com"
```

说明：

- 邮箱建议用你 GitHub 账号里已验证的邮箱，这样提交能正确关联到你的头像和贡献图；
- 不想暴露真实邮箱，可以用 GitHub 提供的 noreply 地址（Settings → Emails → Keep my email addresses private 里能看到形如 `12345678+用户名@users.noreply.github.com` 的地址）；
- 这里用的是 `--global`，对本机所有仓库生效。项目里的 `bootstrap.ps1` 不会改你的全局配置。

验收：

```powershell
git config --global user.name
git config --global user.email
```

两条都返回非空值。

### 1.3 认证方式二选一

GitHub 从 2021 年起**不再支持用账号密码做 Git 操作的认证**。HTTPS 和 SSH 选一种即可，选完不用再折腾另一种。

#### 方式 A：HTTPS + Personal Access Token（PAT）

适合：不想管 SSH key、公司网络只放行 443 端口。

1. 打开 <https://github.com/settings/tokens>，进入
   **Settings → Developer settings → Personal access tokens → Tokens (classic)**
   （页面路径可能调整，以 <https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens> 为准）。
2. 生成新 token：
   - Note 填 `design-system-lab`；
   - Expiration 选 30 天（练习够用，过期重新生成）；
   - 勾选 `repo`（完整仓库读写；只推公开仓库勾 `public_repo` 也可以）；
   - 生成后**立刻复制**，页面关掉就再也看不到了。
3. 第一次 `git push` 时，Git 会弹窗要账号：
   - Username：你的 GitHub 用户名；
   - Password：**粘贴 PAT**（不是账号密码）。
4. Windows 会把凭据存进「凭据管理器」，之后不用重复输入。想换 token 或清掉旧密码：
   **控制面板 → 凭据管理器 → Windows 凭据 → 找到 `git:https://github.com` → 删除**，下次推送会重新询问。
   也可以命令行检查当前凭据助手：

   ```powershell
   git config --global credential.helper
   ```

   输出 `manager` 或 `manager-core` 都正常（Git for Windows 自带）。

常见报错与处理：

| 报错 | 原因 | 处理 |
| --- | --- | --- |
| `remote: Support for password authentication was removed on August 13, 2021.` | 密码栏填了账号密码 | 改用 PAT 当密码 |
| `fatal: Authentication failed for 'https://github.com/...'` | token 过期 / 复制不全 / 权限不够 | 重新生成 token；删掉凭据管理器里的旧记录再试 |
| `remote: Permission to <用户名>/design-system-lab.git denied to <用户名>.` | token 没有 `repo`（或 `public_repo`）权限 | 重新生成并勾选正确 scope |
| `403` | 同上，或组织开启了 SAML SSO 但 token 未授权 | 在 token 设置页点 `Configure SSO` 授权给该组织 |

#### 方式 B：SSH key

适合：经常推代码、不想被 token 过期打扰。

1. 生成密钥（邮箱换成你的）：

   ```powershell
   ssh-keygen -t ed25519 -C "你的邮箱@example.com"
   ```

   连续回车即可：默认保存到 `C:\Users\<你>\.ssh\id_ed25519`，口令可以留空（留空最省事，安全性靠本机账户）。

2. 把**公钥**（`.pub` 结尾）复制到剪贴板：

   ```powershell
   Get-Content "$env:USERPROFILE\.ssh\id_ed25519.pub" | Set-Clipboard
   ```

3. 打开 <https://github.com/settings/keys> →
   **Settings → SSH and GPG keys → New SSH key**：
   - Title 填 `Windows 练习机`；
   - Key type 选 **Authentication key**；
   - Key 粘贴刚才复制的内容（一整行，以 `ssh-ed25519` 开头）；
   - 保存。

4. 测试连接：

   ```powershell
   ssh -T git@github.com
   ```

   第一次会问 `Are you sure you want to continue connecting (yes/no/[fingerprint])?`，输入 `yes` 回车。
   成功时输出类似：

   ```text
   Hi <你的用户名>! You've successfully authenticated, but GitHub does not provide shell access.
   ```

常见报错与处理：

| 报错 | 原因 | 处理 |
| --- | --- | --- |
| `Permission denied (publickey)` | 公钥没加到 GitHub，或加错了文件（加成了私钥） | `ssh -T git@github.com` 复测；确认加的是 `.pub` 文件内容 |
| `ssh: connect to host github.com port 22: Connection timed out` | 网络屏蔽 22 端口 | 改用 HTTPS；或配置 443 端口，见下 |
| `Host key verification failed.` | `known_hosts` 里的旧记录冲突 | 删除 `C:\Users\<你>\.ssh\known_hosts` 里 github.com 那几行后重试 |

22 端口被封时的 443 备用方案（可选）：

在 `C:\Users\<你>\.ssh\config` 里写入（没有这个文件就新建，注意不要带 `#`）：

```text
Host github.com
  HostName ssh.github.com
  Port 443
  User git
```

然后测试（配置生效后 `ssh -T git@github.com` 会自动走 443）：

```powershell
ssh -T -p 443 git@ssh.github.com
```

验收（二选一）：

- HTTPS：能成功 `git push` 一次，且不再被要求输入账号密码（token 已缓存）；
- SSH：`ssh -T git@github.com` 返回 `Hi <你的用户名>! ...`（看到这句输出就算成功；`ssh -T` 成功时的退出码也是 1，不要只看退出码）。

---

## 2. 本地初始化

两条路径选一条。**推荐 A**，但建议至少读一遍 B 的命令，知道脚本替你做了什么。

### 2.1 方式 A：一键脚本（推荐）

在项目根目录执行：

```powershell
pwsh -File scripts/bootstrap.ps1
```

说明：

- `pwsh` 是 PowerShell 7 的命令。**没装 PowerShell 7 也能用**，改用系统自带的 Windows PowerShell 5.1：

  ```powershell
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\bootstrap.ps1
  ```

- 如果提示「无法加载文件 … 因为在此系统上禁止运行脚本」，就是执行策略拦住了。两种处理：
  1. 临时绕过（只影响这一次）：上面命令加上 `-ExecutionPolicy Bypass`；
  2. 永久放开当前用户（推荐给练习机）：
     ```powershell
     Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
     ```
     然后重新运行脚本。

脚本会依次做这些事（每一步都有中文输出）：

1. 检查 `node`、`git` 是否可用，缺了会给出下载链接；
2. 运行 `node scripts/build-tokens.mjs`，生成 `src/styles/tokens.css`；
3. 项目目录还不是 Git 仓库时，执行 `git init -b main`，并设置**仅本仓库**的 `core.autocrlf=false`（不动全局配置）；
4. 如果仓库还没有任何提交，执行 `git add -A` + 首次提交；
5. 传了 `-RepoUrl` 时，添加或更新 `origin`，再 `git push -u origin main`；
6. 打印「下一步」清单。

预期输出（关键行）：

```text
==> 检查依赖：node 与 git
    [完成] node v22.x.x
    [完成] git version 2.x.x.windows.x

==> 生成设计令牌：node scripts/build-tokens.mjs
    [完成] 已生成 src/styles/tokens.css（约 6 KB）

==> 检查 Git 仓库
    [完成] 已初始化 Git 仓库，默认分支 main

==> 设置仅本仓库的换行符策略（core.autocrlf=false）
    [完成] 本仓库 core.autocrlf=false（全局配置未改动）

==> 创建首次提交（如果还没有提交）
    [完成] 已创建首个提交，共 xx 个文件
```

脚本是**幂等**的：再跑一次会重新生成一遍 `tokens.css`，但会跳过 `git init`、跳过首次提交、不会重复添加 remote，也不会产生多余提交。

验收入口：

```powershell
git log --oneline
git branch --show-current
git config --local core.autocrlf
```

预期：`git log` 有一行 `chore: 初始化设计系统练习项目`；分支是 `main`；`core.autocrlf` 是 `false`。

### 2.2 方式 B：手动命令（逐条解释）

如果你已经跑过方式 A，这一节只看不跑；想从零重来，先确认没有需要保留的提交，再删除 `.git` 目录（删除会丢失全部本地历史）。

```powershell
git init -b main
```

- 创建 `.git` 目录，把当前目录变成仓库；
- `-b main` 让默认分支叫 `main`（GitHub 新仓库默认也是 `main`，两边一致可以少踩坑）；
- 需要 Git 2.28+。

```powershell
git config --local core.autocrlf false
```

- 只写进本仓库的 `.git/config`，不碰全局；
- 告诉 Git：检出文件时不要自动把 LF 换成 CRLF。原因见第 9 节。

```powershell
git add -A
```

- 把当前目录所有变化（新增、修改、删除）放进暂存区；
- 被 `.gitignore` 排除的文件不会进来。

```powershell
git status
```

- 看哪些文件已暂存（`Changes to be committed`）、哪些还没暂存；
- 提交前一定要看一眼，确认没有把 `.env`、密钥、临时文件带进去。

```powershell
git commit -m "chore: 初始化设计系统练习项目"
```

- 把暂存区固化成一条提交记录；
- `chore:` 是 Conventional Commits 的类型前缀，表示「杂务/初始化」，第 6 节会系统讲。

验证：

```powershell
git log --oneline -1
git status
git branch --show-current
```

验收：

- `git log --oneline -1` 能看到刚才的提交；
- `git status` 显示工作区干净（`nothing to commit, working tree clean`）；
- 分支为 `main`。

---

## 3. 创建 GitHub 仓库

仓库名建议就用 **`design-system-lab`**，可见性选 **Public**：

- 免费账号的 GitHub Pages 只对公开仓库开放（私有仓库需要 Pro/Team/Enterprise）；
- 名字和本地目录一致，后面所有 URL 都好对应。

### 3.1 网页方式

1. 打开 <https://github.com/new>；
2. Repository name 填 `design-system-lab`；
3. 可见性选 **Public**；
4. **不要勾选** `Add a README file`、`Add .gitignore`、`Choose a license`；
5. 点 `Create repository`。

为什么强调「空仓库」：如果 GitHub 先帮你建了 README，远程就有一条本地没有的提交，第一次 `git push` 会被拒绝（`non-fast-forward`），新手常卡在这里。保持空仓库，`git push` 就是一次干净的首次推送。

创建成功后页面会显示 Quick setup，里面有一行形如：

```text
https://github.com/<你的用户名>/design-system-lab.git
```

这就是后面要用的仓库地址。

### 3.2 GitHub CLI 方式（可选）

安装 GitHub CLI：

```powershell
winget install --id GitHub.cli
```

装完**新开一个终端**，登录并创建仓库：

```powershell
gh --version
gh auth login
```

`gh auth login` 的交互选择：

- What account do you want to log into? → `GitHub.com`
- What is your preferred protocol for Git operations? → `HTTPS`（或 `SSH`，和你 1.3 的选择一致）
- Authenticate Git with your GitHub credentials? → `Yes`
- How would you like to authenticate? → `Login with a web browser`，按提示在浏览器输入一次性代码。

然后在项目根目录执行：

```powershell
gh repo create design-system-lab --public --source=. --remote=origin --push
```

这条命令会：创建远程仓库 → 添加 `origin` → 推送当前分支。**执行完可以直接跳到第 5 节**（第 4 节的推送已经被它做了）。

验收：

- `gh repo view --web` 能在浏览器打开仓库；
- 仓库首页能看到你的文件。

### 3.3 验收

打开 `https://github.com/<你的用户名>/design-system-lab`：

- 能看到 `src/`、`tokens/`、`.github/` 等目录；
- 仓库是 Public；
- 没有 README 也没关系（这个练习项目不强制要求 README）。

---

## 4. 第一次推送

### 4.1 关联远程仓库并推送

在项目根目录执行（地址换成你自己的）：

```powershell
git remote add origin https://github.com/<你的用户名>/design-system-lab.git
git remote -v
git push -u origin main
```

用 SSH 的话，地址换成：

```powershell
git remote add origin git@github.com:<你的用户名>/design-system-lab.git
```

`git remote -v` 应该看到两行（fetch 和 push），都指向同一个地址。

如果提示 `error: remote origin already exists`，说明之前加过 `origin`（例如跑过一键脚本），改地址即可：

```powershell
git remote set-url origin https://github.com/<你的用户名>/design-system-lab.git
```

### 4.2 看懂 `origin`、`origin/main`、`-u`

- `origin`：远程仓库的**别名**，不是网址本身。`git remote add origin <url>` 就是起名。
- `origin/main`：**远程跟踪分支**。它记录「上一次和远程通信时，远程 main 在哪」，不是你硬盘上的分支。你本地真正的分支叫 `main`。
- `-u`（`--set-upstream`）：把本地 `main` 和 `origin/main` 绑定。绑定后：
  - 直接 `git push` 就知道推到哪里；
  - 直接 `git pull` 就知道从哪里拉；
  - `git status` 会告诉你「比 origin/main 领先/落后几个提交」。

首次推送成功的输出里会有类似：

```text
 * [new branch]      main -> main
branch 'main' set up to track 'origin/main'.
```

之后可以用这些命令确认状态：

```powershell
git branch -vv
git status
```

验收：

- 刷新 GitHub 仓库页面，文件都在；
- 本地 `git status` 显示 `Your branch is up to date with 'origin/main'.`（中文版 Git 会显示对应中文）；
- 本地 `git branch -vv` 里 `main` 后面跟着 `[origin/main]`。

### 4.3 推送被拒绝怎么办

如果第 3 步没保持空仓库（例如勾了 README），`git push` 会报：

```text
! [rejected]        main -> main (fetch first)
error: failed to push some refs to '...'
hint: Updates were rejected because the remote contains work that you do not have locally.
```

处理（保留远程 README，把本地提交接到它后面）：

```powershell
git pull --rebase origin main
git push -u origin main
```

如果提示 `refusing to merge unrelated histories`，说明两边是完全独立的历史（本地 `git init` + 远程 README），改用 merge 把远程历史并进来：

```powershell
git pull origin main --allow-unrelated-histories
git push -u origin main
```

（`--allow-unrelated-histories` 是合并参数，不要和 `--rebase` 混用。）

练习项目更简单的做法：删掉远程仓库，重新建一个**空**仓库再推。详见第 10 节。

---

## 5. 开启 GitHub Pages

### 5.1 把 Source 设为 GitHub Actions

1. 打开仓库页面；
2. 进入 **Settings → Pages**；
3. 在 **Build and deployment** 区域，把 **Source** 下拉框选为 **GitHub Actions**；
4. 不需要选主题、不需要选分支。选好后 GitHub 会立即按工作流方式配置 Pages，页面会提示用工作流部署。

官方页面（UI 位置可能调整，以此为准）：
<https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site>

注意：如果 Source 还停留在 `Deploy from a branch`，`Deploy to GitHub Pages` 工作流里的 `actions/configure-pages@v5` 会失败，报错大意是「Pages 未启用或未使用 GitHub Actions 构建」。把 Source 改过来再重跑工作流即可。

### 5.2 第一次部署

Source 改好后，触发一次部署（任选其一）：

- 推一个改动到 `src/` 或 `tokens/`；
- 或者进入 **Actions → 左侧 Deploy to GitHub Pages → Run workflow**（下拉里再点一次 Run workflow；手动触发对应 `workflow_dispatch`）。

然后看运行过程：

1. 仓库页面 → **Actions** 标签页；
2. 左侧选 `Deploy to GitHub Pages`；
3. 点最新一次运行，展开 `构建并部署到 Pages` 这个 job；
4. 依次看到：检出代码 → 安装 Node.js 20 → 生成最新设计令牌 → 配置 Pages → 上传站点目录 → 部署到 GitHub Pages；
5. 全部打勾后，运行详情里会显示部署地址（`environment: github-pages` 的 URL）。

站点地址固定形如：

```text
https://<你的用户名>.github.io/design-system-lab/
```

两个页面都要能打开：

```text
https://<你的用户名>.github.io/design-system-lab/
https://<你的用户名>.github.io/design-system-lab/states.html
```

第一次部署后可能有 1 分钟左右的生效延迟；页面打不开先按 `Ctrl + F5` 强制刷新，或用无痕窗口排除缓存。

### 5.3 环境审批（仓库有保护规则时）

如果仓库对 `github-pages` 环境设置了审批，部署不会立刻执行，而是停在「Waiting for approval」：

1. 进入 **Settings → Environments → github-pages**；
2. 在 **Deployment protection rules** 里可以看到 **Required reviewers**；
3. 如果有审批人，回到 **Actions** 里那次运行，点 **Review deployments**，勾选 `github-pages`，再点 **Approve and deploy**。

环境审批属于仓库/套餐能力，个人公开仓库一般可用；看不到这个选项就说明当前仓库没配置审批，或者套餐不支持。以官方文档为准：
<https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments>

另外：如果 `main` 开了分支保护（要求 PR 才能合并），`Build tokens` 的自动提交会被拒绝。练习项目不建议一上来就开保护；真要开，需要允许 GitHub Actions 绕过，或把自动提交改成开 PR。

### 5.4 验收

- [ ] Actions 里 `Deploy to GitHub Pages` 最近一次运行是绿色；
- [ ] 访问 `https://<你的用户名>.github.io/design-system-lab/` 能看到首页；
- [ ] 访问 `.../states.html` 能看到状态矩阵；
- [ ] 打开浏览器开发者工具 → Network，`styles/tokens.css`、`styles/base.css`、`app.js` 都是 200，不是 404；
- [ ] 页面样式正常（说明 `tokens.css` 被正确加载，不是裸 HTML）。

---

## 6. 日常开发循环

### 6.1 标准循环

每次改东西，按这个顺序走。想边改边看效果，先**另开一个终端**运行 `npm run dev`（会占用那个终端，`Ctrl + C` 退出），浏览器打开 <http://localhost:4173>；然后回到当前终端执行：

```powershell
# 1) 看现状：改了哪些文件
git status
git diff

# 2) 只想看某个文件
git diff src/styles/components.css

# 3) 暂存（可以只加需要的文件）
git add src/styles/components.css
# 或者全部：
git add -A

# 4) 提交，写清楚改了什么
git commit -m "feat(button): 增加 loading 状态"

# 5) 推送
git push

# 6) 去 GitHub 仓库的 Actions 标签页看运行结果
```

几个习惯：

- **提交前一定 `git diff`**，尤其确认没有把 `.env`、`node_modules/`、临时文件带进去；
- **一次提交只做一件事**：改按钮就只提交按钮，别把令牌重新生成、文档修改混在一条提交里；
- `git add -A` 很方便，但它是「全部」，不确定时用 `git status` 先核对。

### 6.2 改设计令牌的专门流程

令牌是「一份 JSON 生成一份 CSS」，所以**两个文件要一起提交**：

```powershell
# 1) 编辑 tokens/tokens.json（例如调 --color-brand-bg 的值）

# 2) 重新生成 CSS
npm run tokens

# 3) 本地校验，确认生成物和 JSON 一致
npm run tokens:check

# 4) 两个文件一起提交
git add tokens/tokens.json src/styles/tokens.css
git commit -m "chore(tokens): 重新生成 tokens.css"
git push
```

只提交 `tokens.json`、忘了 `tokens.css` 会怎样？

- 如果走 PR：`Build tokens` 的 `--check` 步骤失败，PR 变红，提示 `tokens.css 已过期`；
- 如果直接推 `main`：`Build tokens` 会替你生成并自动提交一次，提交信息是 `chore(tokens): 重新生成 tokens.css [skip ci]`。

两种结果都安全，但**推荐本地先 `npm run tokens` 再一起提交**：历史更干净，也不会多出一条机器人提交。

### 6.3 提交信息规范（Conventional Commits）

格式：

```text
<类型>(<范围>): <一句话说明>
```

常用类型：

| 类型 | 用途 | 本项目示例 |
| --- | --- | --- |
| `feat` | 新功能/新样式 | `feat(button): 增加 loading 状态` |
| `fix` | 修 bug | `fix(card): 修正暗色下边框颜色` |
| `chore` | 杂务、生成物、依赖 | `chore(tokens): 重新生成 tokens.css` |
| `docs` | 文档 | `docs: 补充 Figma 同步步骤` |
| `refactor` | 重构，不改行为 | `refactor(card): 抽出卡片头部样式` |
| `style` | 格式调整（空格、分号） | `style: 统一 CSS 缩进` |
| `ci` | 工作流改动 | `ci: 调整 Pages 部署触发路径` |

范围（scope）建议用组件或目录名：`button`、`card`、`tokens`、`pages`、`figma`。

规矩不用背，记住两点就够：

1. 标题写「做了什么」，不要写「update」「修改一下」；
2. 一条提交对应一个可回滚的改动。

规范原文：<https://www.conventionalcommits.org/zh-hans/v1.0.0/>

### 6.4 验收

- [ ] `git status` 里没有意料之外的文件；
- [ ] `git log --oneline -5` 的提交信息能看懂；
- [ ] push 后 Actions 里对应的工作流是绿色；
- [ ] 如果改了令牌，线上刷新后颜色/间距确实变了。

---

## 7. 分支 + Pull Request 练习（一人团队也走一遍）

直接推 `main` 适合个人练习，但真实项目基本都走「分支 → PR → 合并」。这一节完整走一遍，哪怕只有你一个人。

### 7.1 建分支、改东西、推分支

```powershell
# 1) 确保从最新的 main 开始
git switch main
git pull

# 2) 建并切换到功能分支
git switch -c feat/card-pressed-state

# 3) 改代码（例如给卡片补按下态样式），然后看差异
git status
git diff

# 4) 提交
git add src/styles/components.css
git commit -m "feat(card): 增加按下态样式"

# 5) 第一次推这个分支，要带 -u
git push -u origin feat/card-pressed-state
```

推送成功后，终端会输出一个以 `remote:` 开头的链接，形如：

```text
remote:
remote: Create a pull request for 'feat/card-pressed-state' on GitHub by visiting:
remote:      https://github.com/<你的用户名>/design-system-lab/pull/new/feat/card-pressed-state
```

### 7.2 在 GitHub 上开 PR

1. 打开仓库页面，通常会出现 **Compare & pull request** 的提示条；没有的话走
   **Pull requests → New pull request**；
2. base 选 `main`，compare 选 `feat/card-pressed-state`；
3. 标题写清楚，例如 `feat(card): 增加按下态样式`；描述里写「改了什么、怎么验证」；
4. 点 **Create pull request**。

### 7.3 看 PR 上的检查

PR 页面下方 **Checks** 区域会出现 `Build tokens` 工作流的 `令牌生成 / 校验` 检查——**前提是 PR 改了 `tokens/**` 或 `scripts/build-tokens.mjs`**。如果这个 PR 只改了 `src/**`（比如本节例子里只动 `components.css`），`Build tokens` 不会触发，Checks 可能是空的；这是 `paths` 过滤的正常结果，不代表 CI 坏了。想让 PR 上看到检查，就在分支里顺手调一个令牌值并 `npm run tokens`，让改动包含 `tokens/tokens.json` 和 `src/styles/tokens.css`。

当 Checks 里出现 `令牌生成 / 校验` 时：

- 绿色：`tokens.css` 和 `tokens.json` 一致，可以合并；
- 红色：点 **Details** 看日志，通常是 `--check` 报「已过期」。修复方式：

  ```powershell
  npm run tokens
  git add src/styles/tokens.css
  git commit -m "chore(tokens): 重新生成 tokens.css"
  git push
  ```

  推送后 PR 会自动重跑检查。

注意：`Deploy to GitHub Pages` 只在 push 到 `main` 时触发，PR 上不会部署，这是刻意的——没合并的代码不该上线。

### 7.4 合并、删分支、回本地同步

在 PR 页面：

1. 点 **Merge pull request** → **Confirm merge**（团队项目里通常选 Squash and merge，练习项目用默认即可）；
2. 合并后点 **Delete branch** 删除远程分支。

回到本地：

```powershell
git switch main
git pull
git branch -d feat/card-pressed-state
```

说明：

- `git branch -d` 只在分支已合并时成功；如果提示未合并，确认内容真的不要了再用 `-D`（强制删除，谨慎）；
- 如果合并时选了 **Squash and merge**，GitHub 会把分支提交压成一条新提交，本地 `git branch -d` 可能提示「未合并」。确认内容已经进 `main` 后，用 `git branch -D feat/card-pressed-state` 删除即可；
- 如果远程分支没删掉，也可以手动清理：`git push origin --delete feat/card-pressed-state`；
- 合并到 `main` 后，`Deploy to GitHub Pages` 会自动跑一次，线上更新。

### 7.5 验收

- [ ] 分支推送成功，PR 能打开；
- [ ] 若 PR 涉及 `tokens/**` 或生成脚本，Checks 里 `Build tokens` 为绿色；只改 `src/**` 时 Checks 为空属正常；
- [ ] 合并后 `main` 上有你的提交；
- [ ] 本地 `git switch main` + `git pull` 后能看到合并结果；
- [ ] 分支已删除（本地 `git branch` 里看不到）。

---

## 8. 回滚与撤错

先分清三种状态：**没暂存**、**已暂存没提交**、**已提交**。不同状态用不同命令。

| 场景 | 命令 | 说明 |
| --- | --- | --- |
| 改了文件但没 `git add`，想丢弃 | `git restore <文件>` | 用暂存区内容覆盖工作区（没暂存过时相当于恢复成最近一次提交）；丢弃后无法用普通方式找回 |
| 丢弃所有未暂存修改 | `git restore .` | 危险，先 `git status` 看清 |
| 已 `git add`，想撤出暂存区（保留修改） | `git restore --staged <文件>` | 文件内容不变，只是回到「未暂存」 |
| 提交信息写错，还没 push | `git commit --amend -m "新的信息"` | 会改写最后一条提交；已 push 过就不要用（除非接受 force push） |
| 提交内容漏了文件，还没 push | `git add <漏的文件>` 然后 `git commit --amend --no-edit` | 把漏的文件并进上一条提交 |
| 想撤销某条**已经 push** 的提交 | `git revert <commit>` | 生成一条「反向提交」，历史保留，最安全 |
| 想撤销最近一条本地提交但保留改动 | `git reset --soft HEAD~1` | 提交没了，改动回到暂存区，可重新提交 |
| 误操作后想找回提交 | `git reflog` | 列出 HEAD 移动历史，找到丢失的 commit 再 `git switch -c rescue <sha>` |

### 8.1 推荐：用 `git revert` 撤销已推送的提交

```powershell
# 1) 找到要撤销的提交
git log --oneline -10

# 2) 生成反向提交（<sha> 换成上一步看到的短哈希）
git revert <sha>

# 3) 推上去
git push
```

为什么推荐 `revert`：它不改写历史，别人拉代码不会冲突；`main` 是共享分支时这是唯一安全的做法。

### 8.2 不推荐随便用 `git reset --hard`

```powershell
git reset --hard HEAD~1
```

它会同时做三件事：移动分支指针、清空暂存区、**删掉工作区里未提交的修改**。删掉的内容不在提交里，`git reflog` 也救不回来。

只有这些情况可以考虑：

- 这条提交**只在你本地**，从没 push；
- 你确认工作区没有想保留的修改；
- 你接受「这条提交彻底消失」。

已经 push 的提交更不能用 `reset --hard` + `push --force`：会改写远程历史，协作者拉取会冲突。用 `revert`。

### 8.3 验收

练习（在分支上做，别在 `main` 上试）：

```powershell
git switch -c practice/undo
# 随便改一个文件并提交
git add -A
git commit -m "test: 故意提交一条"
# 撤销它
git revert --no-edit HEAD
git log --oneline -3
```

- [ ] 能看到 `Revert "test: 故意提交一条"` 这条新提交；
- [ ] 文件内容回到改动前；
- [ ] 练习分支用完删掉，不影响 `main`。

---

## 9. `.gitignore` 与 `.gitattributes`

这两个文件决定了「哪些东西不进仓库」和「换行符怎么处理」。本项目已经准备好，先看现状：

```powershell
Get-Content .gitignore
Get-Content .gitattributes
```

### 9.1 `.gitignore`：不该进仓库的东西

当前内容（含注释）：

```text
# 依赖（本项目零依赖，正常不会有 node_modules，留着防止以后加工具链）
node_modules/

# 系统文件
.DS_Store
Thumbs.db
desktop.ini

# 编辑器
.vscode/
.idea/

# 环境变量与密钥：绝对不要提交
.env
.env.*
*.pem

# 日志
*.log
npm-debug.log*

# 构建产物（目前只有 tokens.css 是"生成物但需要提交"，不要忽略它）
dist/
```

逐条解释：

- `node_modules/`：以后加工具链时会出现，体积巨大且可由 `package.json` 还原，永远不提交；
- `.DS_Store` / `Thumbs.db` / `desktop.ini`：macOS / Windows 的目录元数据，属于个人机器，不该进团队仓库；
- `.vscode/`、`.idea/`：编辑器个人配置；如果团队要共享调试配置，把要共享的文件单独 `git add -f`，或调整忽略规则；
- `.env`、`.env.*`、`*.pem`：**密钥和证书，绝对不进仓库**。一旦提交，按第 10.8 节处理；
- `*.log`、`npm-debug.log*`：日志；
- `dist/`：打包产物（本项目目前没有构建产物目录，先留着）。

注意最后一行注释：`src/styles/tokens.css` 虽然是生成物，但**必须提交**。原因是 GitHub Pages 直接发布 `src/`，这份 CSS 是站点运行需要的文件；而且 PR 的 `--check` 校验的就是它。不要把它加进 `.gitignore`。

### 9.2 `.gitattributes`：换行符统一为 LF

当前内容：

```text
# 统一换行符为 LF：避免 Windows 本地提交的 CRLF 与 GitHub Actions（Ubuntu）生成的 LF
# 反复产生"整个文件都变了"的假 diff
* text=auto eol=lf

# 二进制文件不做换行转换
*.png binary
*.jpg binary
*.jpeg binary
*.webp binary
*.ico binary
*.woff binary
*.woff2 binary
```

为什么重要：

- Windows 上 Git 默认可能把 LF 转成 CRLF（`core.autocrlf=true`）。仓库里存一份、检出又变一份，很容易出现「我只改了一行，diff 却是整个文件」；
- 这个项目的 CI 跑在 Ubuntu 上，生成的 `tokens.css` 是 LF。如果本地是 CRLF，每次 CI 生成都会认为整个文件变了，于是自动提交反复产生 diff；
- `* text=auto eol=lf` 的意思是：文本文件统一按 LF 存储、按 LF 检出；`binary` 声明告诉 Git 图片和字体不要做换行转换，避免损坏文件。

`bootstrap.ps1` 还会在本仓库设置 `core.autocrlf=false`，两者配合，Windows 上也不会再出现假 diff。

如果以后接手一个已经有很多 CRLF 文件的老仓库，加完 `.gitattributes` 后执行一次「重新归一化」：

```powershell
git add --renormalize .
git status
git commit -m "chore: 统一换行符为 LF"
```

### 9.3 如果文件不存在

本项目已经有这两个文件，不需要你创建。如果你在别的目录重建项目，可以照抄上面的内容；最小可用版本是：

`.gitignore`：

```text
node_modules/
.DS_Store
Thumbs.db
.env
.env.*
*.log
```

`.gitattributes`：

```text
* text=auto eol=lf
*.png binary
*.jpg binary
*.woff2 binary
```

创建后记得提交：

```powershell
git add .gitignore .gitattributes
git commit -m "chore: 添加 .gitignore 和 .gitattributes"
```

### 9.4 验收

```powershell
git check-ignore -v .env
git check-ignore -v node_modules/example.js
```

- [ ] 两条命令都能输出匹配到的规则（说明忽略生效）；
- [ ] `git check-ignore -v src/styles/tokens.css` 返回「没有匹配」（说明生成物没有被误忽略，返回码为 1 是正常的）；
- [ ] `git status` 里看不到 `.env`、`node_modules/`、`Thumbs.db`。

---

## 10. 常见问题

### 10.1 认证失败 / 403

**现象**：

```text
fatal: Authentication failed for 'https://github.com/<用户名>/design-system-lab.git'
```

或：

```text
remote: Permission to <用户名>/design-system-lab.git denied to <用户名>.
fatal: unable to access '...': The requested URL returned error: 403
```

**原因**：HTTPS 用账号密码、PAT 过期/权限不足、凭据管理器缓存了旧密码。

**处理**：

1. 确认 `git remote -v` 里是 HTTPS 地址；
2. 到 <https://github.com/settings/tokens> 重新生成 token（勾 `repo` 或 `public_repo`）；
3. 清掉旧凭据：控制面板 → 凭据管理器 → Windows 凭据 → 删除 `git:https://github.com`；
4. 重新 `git push`，Username 填用户名，Password 粘贴 token；
5. 仍然 403 且属于组织仓库：检查 token 是否完成 SSO 授权。

**验证**：`git push` 成功，`git remote -v` 不变。

### 10.2 `rejected non-fast-forward`

**现象**：

```text
! [rejected]        main -> main (fetch first)
error: failed to push some refs
hint: Updates were rejected because the remote contains work that you do not have locally.
```

**原因**：远程有你本地没有的提交（最常见：创建仓库时勾了 README / .gitignore / license；或者你在网页上直接改过文件）。

**处理**：

```powershell
git pull --rebase origin main
git push -u origin main
```

如果提示 `refusing to merge unrelated histories`：

```powershell
git pull origin main --allow-unrelated-histories
git push -u origin main
```

（`--allow-unrelated-histories` 是合并参数，不要和 `--rebase` 混用。）

实在搞不定、仓库又是刚建的：删除 GitHub 上的仓库，重新建一个空仓库，按第 3、4 节重来。练习项目没有历史包袱，这往往比修历史快。

**验证**：`git status` 显示与 `origin/main` 同步，GitHub 上能看到你的提交。

### 10.3 本地默认分支是 `master`

**现象**：`git branch --show-current` 输出 `master`，但 GitHub 仓库默认分支是 `main`，推送后出现两条分支。

**处理**（本地改名）：

```powershell
git branch -M main
```

如果已经 push 过 `master`，还要把远程默认分支改成 `main`：
**Settings → General → Default branch → 切换到 `main`**，再删除远程 `master`：

```powershell
git push origin --delete master
```

**验证**：`git branch --show-current` 输出 `main`；GitHub 仓库首页默认分支显示 `main`。

预防：`git config --global init.defaultBranch main`，以后 `git init` 默认就是 main。

### 10.4 Actions 权限不足（自动提交 403）

**现象**：`Build tokens` 在「提交生成物」步骤失败，日志里有 `remote: Permission to ... denied` 或 `403`。

**原因**：仓库的 Workflow permissions 被设成了只读，工作流里写的 `permissions: contents: write` 会被仓库设置压回只读。

**处理**：
**Settings → Actions → General → Workflow permissions** → 选 **Read and write permissions** → **Save**，然后
**Actions → Build tokens → Re-run all jobs**。

**验证**：重新运行后该步骤成功；如果 `tokens.css` 本来就没变化，日志会显示 `Nothing to commit`，也是成功。

补充：如果 `main` 开了分支保护，机器人推送也会被拒绝。处理方式二选一：允许 GitHub Actions 绕过保护，或把自动提交改成「创建一个 PR」。

### 10.5 Pages 打开是 404

按可能性从高到低排查：

1. **Source 没设为 GitHub Actions**：Settings → Pages → Build and deployment → Source 选 `GitHub Actions`；
2. **部署工作流没跑成功**：Actions → `Deploy to GitHub Pages` → 最近一次运行是否绿色；
3. **`index.html` 不在 `src/` 根目录**：本项目必须是 `src/index.html`，上传的是 `./src`；
4. **URL 少了仓库名**：项目站点是 `https://<用户名>.github.io/design-system-lab/`，不是 `https://<用户名>.github.io/`；
5. **刚部署完还没生效**：等 1 分钟，`Ctrl + F5`，或用无痕窗口；
6. **仓库是 Private**：免费账号的 Pages 不支持私有仓库，改成 Public 或升级套餐；
7. **页面里用了绝对路径**：`/styles/tokens.css` 会 404，改成 `./styles/tokens.css`。

**验证**：无痕窗口能打开首页和 `states.html`，开发者工具 Network 里 CSS/JS 都是 200。

### 10.6 Pages 部署卡住 / 一直排队

**现象**：运行状态一直是 `Queued` 或 `Waiting`，或者卡在 deploy 步骤。

**原因与处理**：

- **环境审批**：Settings → Environments → `github-pages` 里配了 Required reviewers，需要到运行详情页 **Review deployments** 批准；
- **并发锁**：`deploy-pages.yml` 用了 `concurrency: group: pages`，同一时间只允许一个部署；`cancel-in-progress: true` 会让新的 push 取消还在跑的旧部署（GitHub 官方 Pages 模板用 `false`，更保守）。如果运行一直卡着，到 Actions 里 **Cancel workflow** 掉旧运行，再 **Re-run**；
- **Pages 服务临时故障**：看 <https://www.githubstatus.com/>，或过几分钟重试；
- **构建产物太大/路径错**：检查 `upload-pages-artifact` 步骤日志，确认上传的是 `src/`。

**验证**：重新运行后 deploy job 变绿，运行详情里出现部署 URL。

### 10.7 Windows 换行符导致的大 diff

**现象**：只改了一行，`git diff` 却显示整个文件都变了；或者 CI 每次都在自动提交 `tokens.css`。

**原因**：本地 CRLF、仓库/CI 是 LF。

**处理**：

```powershell
git config --local core.autocrlf false
git add --renormalize .
git status
git commit -m "chore: 统一换行符为 LF"
```

确认 `.gitattributes` 里有 `* text=auto eol=lf`。之后 `git diff` 应该只显示真正改动的行。

**验证**：`git diff --stat` 的行数变化和实际改动量一致。

### 10.8 误提交了 `.env`

**第一原则：先把密钥当作已泄露。** 立刻去对应平台撤销/轮换密钥（GitHub token、云服务 Access Key、数据库密码），再处理 Git 历史。历史改写只解决「别人还能不能翻到」，不能解决「已经泄露」。

删历史（会改写所有提交，协作者必须重新克隆）：

```powershell
# 安装 git-filter-repo（需要 Python 3；装完用 git filter-repo --version 确认可用）
pip install git-filter-repo

# 从所有历史里删掉 .env
git filter-repo --path .env --invert-paths

# filter-repo 默认会移除 origin，需要重新加回来
git remote add origin https://github.com/<你的用户名>/design-system-lab.git
git push --force --all
git push --force --tags
```

注意：

- `git filter-repo` 会改写提交哈希，所有协作者都要重新 `git clone`；
- 如果你只是个人练习、没有协作者，**更简单的是删掉远程仓库重建**，把本地 `.env` 加进 `.gitignore`，重新初始化推送；
- 不要用网上抄来的 `git filter-branch` 复杂脚本，容易把仓库搞坏。

**验证**：GitHub 仓库里搜不到 `.env`；本地 `git log --all -- .env` 没有输出。

### 10.9 脚本因执行策略无法运行

**现象**：

```text
无法加载文件 ...\bootstrap.ps1，因为在此系统上禁止运行脚本。
```

**处理**：临时绕过：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\bootstrap.ps1
```

或永久放开当前用户：

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

`RemoteSigned` 的含义：本地写的脚本可以跑，从网上下载的脚本需要先 `Unblock-File`。**不要**设成 `Unrestricted`。

**验证**：重新运行脚本，不再报执行策略错误。

### 10.10 `gh` 命令找不到

**现象**：`gh : 无法将“gh”项识别为 cmdlet...`

**处理**：

```powershell
winget install --id GitHub.cli
```

装完**新开终端**再 `gh --version`。如果 `winget` 不可用，到 <https://cli.github.com/> 下载安装包。

**验证**：`gh --version` 输出版本号；`gh auth status` 显示已登录。

---

## 11. 验收清单

全部打勾，说明这一阶段真的走完了：

- [ ] `node --version` ≥ 18，`git --version` ≥ 2.28；
- [ ] `git config --global user.name` / `user.email` 都有值；
- [ ] 认证可用：HTTPS 推送不再问密码（token 已缓存），或 `ssh -T git@github.com` 返回成功；
- [ ] 本地仓库在 `main` 分支，`git log --oneline` 能看到初始化提交；
- [ ] `git config --local core.autocrlf` 为 `false`（全局配置没被改动）；
- [ ] GitHub 上有名为 `design-system-lab` 的 Public 仓库，且不是用 README 初始化的；
- [ ] `git remote -v` 有 `origin`，`git branch -vv` 显示 `main` 跟踪 `origin/main`；
- [ ] `Build tokens` 在 push 后运行成功（有自动提交或 `Nothing to commit` 都算成功）；
- [ ] Settings → Pages → Source 已选 `GitHub Actions`；
- [ ] `Deploy to GitHub Pages` 最近一次运行绿色；
- [ ] `https://<你的用户名>.github.io/design-system-lab/` 和 `.../states.html` 都能打开且样式正常；
- [ ] 完整走过一次「分支 → push → PR → 检查 → 合并 → 删分支 → 本地 `git switch main` + `git pull`」。

---

## 12. 官方链接与版本说明

### 12.1 本文引用的 GitHub 设置入口

| 要做的事 | 入口（以官方页面为准） |
| --- | --- |
| 开启 Pages | Settings → Pages → Build and deployment → Source: `GitHub Actions` |
| 看 Pages 文档 | <https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site> |
| 改工作流权限 | Settings → Actions → General → Workflow permissions |
| 配环境审批 | Settings → Environments → `github-pages` → Required reviewers |
| 改默认分支 | Settings → General → Default branch |
| 配分支保护 | Settings → Branches → Branch protection rules |
| 加 SSH key | Settings → SSH and GPG keys |
| 生成 PAT | Settings → Developer settings → Personal access tokens |

### 12.2 工作流里用到的 Action

版本号只写了主版本（`@v4` 这种 tag 会指向该主版本的最新小版本）。升级时以各仓库 README 为准：

| Action | 本文版本 | 官方地址 |
| --- | --- | --- |
| `actions/checkout` | `@v4` | <https://github.com/actions/checkout> |
| `actions/setup-node` | `@v4` | <https://github.com/actions/setup-node> |
| `actions/configure-pages` | `@v5` | <https://github.com/actions/configure-pages> |
| `actions/upload-pages-artifact` | `@v3` | <https://github.com/actions/upload-pages-artifact> |
| `actions/deploy-pages` | `@v4` | <https://github.com/actions/deploy-pages> |
| `stefanzweifel/git-auto-commit-action` | `@v5` | <https://github.com/stefanzweifel/git-auto-commit-action> |

### 12.3 其它官方链接

- GitHub Actions 工作流语法（含 `paths` 过滤）：
  <https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax>
- `GITHUB_TOKEN` 权限与「不触发新工作流」：
  <https://docs.github.com/en/actions/tutorials/authenticate-with-github_token>
- 跳过 CI 运行（`[skip ci]`）：
  <https://docs.github.com/en/actions/how-tos/manage-workflow-runs/skip-workflow-runs>
- GitHub Pages 文档总览（自定义域名等）：
  <https://docs.github.com/en/pages>
- GitHub CLI `gh repo create`：
  <https://cli.github.com/manual/gh_repo_create>
- Conventional Commits 中文版：
  <https://www.conventionalcommits.org/zh-hans/v1.0.0/>
- SSH 生成密钥并添加到账号：
  <https://docs.github.com/en/authentication/connecting-to-github-with-ssh/generating-a-new-ssh-key-and-adding-it-to-the-ssh-agent>
- 测试 SSH 连接：
  <https://docs.github.com/en/authentication/connecting-to-github-with-ssh/testing-your-ssh-connection>
- `git restore`：<https://git-scm.com/docs/git-restore>
- `git revert`：<https://git-scm.com/docs/git-revert>
- `git-filter-repo`：<https://github.com/newren/git-filter-repo>

### 12.4 版本提醒

- GitHub 的网页 UI（设置项位置、按钮名称）会调整；本文写的是当前路径，找不到时以上面的官方文档和页面搜索为准；
- GitHub Docs 在 2026 年调整过 URL 结构（例如旧链接 `configure-publishing-source` 已 404）。本文已换成可用的新链接；如果哪天再失效，到 <https://docs.github.com> 按标题搜索即可；
- Action 的主版本会升级（例如 Pages 系列出 `v6`），升级时改 `.github/workflows/*.yml` 里的一行，然后推一次、看 Actions 是否通过；
- 本文写作时 `setup-node` 固定 Node 20。如果 GitHub 宣布 Node 20 弃用，把工作流里的 `node-version: '20'` 改成新的 LTS 即可；`package.json` 里的 `engines.node` 只是最低版本要求（`>=18`），不必每次升级都跟着改。

---

## 附录：命令速查

```powershell
# ---- 本地初始化 ----
pwsh -File scripts/bootstrap.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\bootstrap.ps1

git init -b main
git config --local core.autocrlf false
git add -A
git status
git commit -m "chore: 初始化设计系统练习项目"

# ---- 远程 ----
git remote add origin https://github.com/<你的用户名>/design-system-lab.git
git remote -v
git push -u origin main
git branch -vv

# ---- 日常 ----
git status
git diff
git add <文件>
git add -A
git commit -m "feat(button): 增加 loading 状态"
git push

# ---- 分支与 PR ----
git switch main
git pull
git switch -c feat/card-pressed-state
git push -u origin feat/card-pressed-state
git branch -d feat/card-pressed-state

# ---- 令牌 ----
npm run tokens
npm run tokens:check

# ---- 回滚 ----
git restore <文件>
git restore --staged <文件>
git revert <sha>
git reflog

# ---- 排查 ----
git log --oneline -10
git remote -v
git config --local core.autocrlf
```
