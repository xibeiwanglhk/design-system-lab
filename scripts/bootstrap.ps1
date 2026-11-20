#Requires -Version 5.1
<#
.SYNOPSIS
    设计系统练习项目 · 一键初始化脚本（Git + GitHub）

.DESCRIPTION
    依次完成四件事，每一步都有中文提示：
      1. 检查 node、git 是否已安装（缺了就给出安装地址）；
      2. 运行 node scripts/build-tokens.mjs 生成 src/styles/tokens.css；
      3. 需要时初始化 Git 仓库（分支 main，且只在本仓库设置 core.autocrlf=false）
         并创建首次提交；
      4. 传入 -RepoUrl 时关联远程仓库并推送 main。

    脚本是幂等的：重复运行不会重复初始化、不会重复提交、不会重复添加 remote。

.PARAMETER RepoUrl
    GitHub 仓库地址，HTTPS 或 SSH 都可以，例如：
      https://github.com/<你的用户名>/design-system-lab.git
      git@github.com:<你的用户名>/design-system-lab.git
    不传这个参数时，脚本只做本地初始化，并打印之后手动关联远程仓库的命令。

.EXAMPLE
    pwsh -File scripts/bootstrap.ps1

.EXAMPLE
    pwsh -File scripts/bootstrap.ps1 -RepoUrl https://github.com/<你的用户名>/design-system-lab.git

.NOTES
    - 只改本仓库的 .git/config，不会修改全局 git 配置；
    - 不会执行 git push --force、git reset --hard 这类破坏性命令；
    - 已在 Windows PowerShell 5.1 与 PowerShell 7 下按同一套语法编写。
#>
[CmdletBinding()]
param(
    [string]$RepoUrl = ''
)

$ErrorActionPreference = 'Stop'

# 任何未预期的终止性错误：打印中文说明并以退出码 1 结束（CI / 终端都能看到失败）。
trap {
    Write-Host ''
    Write-Host "[失败] 脚本执行中出现未预期的错误：$($_.Exception.Message)" -ForegroundColor Red
    Write-Host "       出错位置：$($_.InvocationInfo.PositionMessage)" -ForegroundColor DarkGray
    Write-Host ''
    exit 1
}

# ============================================================ 输出小工具
function Write-Step {
    param([string]$Message)
    Write-Host ''
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Write-Ok {
    param([string]$Message)
    Write-Host "    [完成] $Message" -ForegroundColor Green
}

function Write-Info {
    param([string]$Message)
    Write-Host "    $Message"
}

function Write-Warn {
    param([string]$Message)
    Write-Host "    [注意] $Message" -ForegroundColor Yellow
}

function Fail {
    param(
        [string]$Message,
        [string[]]$Hints = @()
    )
    Write-Host ''
    Write-Host "[失败] $Message" -ForegroundColor Red
    foreach ($hint in $Hints) {
        Write-Host "       $hint" -ForegroundColor Red
    }
    Write-Host ''
    exit 1
}

# 读取某个命令的版本号；失败返回 $null。原生命令的 stderr 不能把脚本打断，
# 所以这里临时把 ErrorActionPreference 调回 Continue。
function Get-CommandVersion {
    param(
        [Parameter(Mandatory = $true)][string]$Executable,
        [string]$VersionArgument = '--version'
    )
    $previous = $ErrorActionPreference
    $output = @()
    try {
        $ErrorActionPreference = 'Continue'
        # 不要用 Select-Object -First 1：它会在读到第一行后提前结束管道，
        # 导致原生命令被强制终止、$LASTEXITCODE 变成 -1。
        $output = @(& $Executable $VersionArgument 2>&1)
        $exitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previous
    }
    if ($exitCode -ne 0 -or $output.Count -eq 0) { return $null }
    return ([string]$output[0]).Trim()
}

# 统一的 git 调用：默认把输出直接打到终端（保留进度和颜色），
# -Capture 时把输出收进返回值，供脚本判断。
function Invoke-Git {
    param(
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [switch]$Capture,
        [switch]$Quiet
    )
    Push-Location -LiteralPath $ProjectRoot
    $previous = $ErrorActionPreference
    $lines = @()
    try {
        # git 会往 stderr 写进度/警告；EAP=Stop 时那会被当成终止性错误，这里临时放开。
        $ErrorActionPreference = 'Continue'
        if (-not $Quiet) {
            Write-Host "    $ git $($Arguments -join ' ')" -ForegroundColor DarkGray
        }
        if ($Capture) {
            $lines = @(& $GitExe @Arguments 2>&1 | ForEach-Object { [string]$_ })
        } else {
            & $GitExe @Arguments
        }
        $exitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previous
        Pop-Location
    }
    return [pscustomobject]@{
        ExitCode = $exitCode
        Output   = $lines
    }
}

function Test-AnyCommit {
    $probe = Invoke-Git -Arguments @('rev-parse', '--verify', '--quiet', 'HEAD') -Capture -Quiet
    return ($probe.ExitCode -eq 0)
}

# ============================================================ 开场
Write-Host ''
Write-Host '============================================================' -ForegroundColor Cyan
Write-Host '   设计系统练习项目 · 一键初始化（Git + GitHub）' -ForegroundColor Cyan
Write-Host '============================================================' -ForegroundColor Cyan

# ============================================================ 0. 定位项目根目录
$ProjectRoot = $PSScriptRoot
if (-not [string]::IsNullOrEmpty($ProjectRoot)) {
    $ProjectRoot = Split-Path -Parent $ProjectRoot
}
if ([string]::IsNullOrEmpty($ProjectRoot)) {
    $ProjectRoot = (Get-Location).Path
}

$buildScript = Join-Path $ProjectRoot 'scripts\build-tokens.mjs'
$tokensFile = Join-Path $ProjectRoot 'tokens\tokens.json'

# 从别的目录调用时，脚本自身的路径才是准的；找不到就退回当前目录再试一次。
if (-not (Test-Path -LiteralPath $buildScript) -or -not (Test-Path -LiteralPath $tokensFile)) {
    $currentDir = (Get-Location).Path
    if ((Test-Path -LiteralPath (Join-Path $currentDir 'scripts\build-tokens.mjs')) -and
        (Test-Path -LiteralPath (Join-Path $currentDir 'tokens\tokens.json'))) {
        $ProjectRoot = $currentDir
        $buildScript = Join-Path $ProjectRoot 'scripts\build-tokens.mjs'
        $tokensFile = Join-Path $ProjectRoot 'tokens\tokens.json'
    } else {
        Fail '找不到 tokens/tokens.json 或 scripts/build-tokens.mjs，无法继续。' @(
            '本脚本必须放在项目的 scripts 目录里运行。',
            "脚本所在目录：$PSScriptRoot",
            '正确用法：在项目根目录执行  pwsh -File scripts/bootstrap.ps1'
        )
    }
}

Set-Location -LiteralPath $ProjectRoot
Write-Step "项目目录：$ProjectRoot"

# ============================================================ 1. 依赖检查
Write-Step '检查依赖：node 与 git'

$nodeCommand = Get-Command -Name 'node' -CommandType Application -ErrorAction SilentlyContinue |
    Select-Object -First 1
if ($null -eq $nodeCommand) {
    $nodeCommand = Get-Command -Name 'node' -ErrorAction SilentlyContinue | Select-Object -First 1
}
if ($null -eq $nodeCommand) {
    Fail '没有找到 node 命令：Node.js 未安装，或者安装了但没加入 PATH。' @(
        '下载安装（选 LTS 版本）：https://nodejs.org/zh-cn/download',
        '安装完成后关闭当前终端，重新打开再运行本脚本。',
        '自检命令：node --version'
    )
}
$NodeExe = $nodeCommand.Source
$nodeVersion = Get-CommandVersion -Executable $NodeExe
if ($null -eq $nodeVersion) {
    Fail 'node 命令存在，但执行 node --version 失败。' @(
        '可能是安装损坏或 PATH 指向了错误的文件。',
        '重新安装 Node.js LTS 后再试：https://nodejs.org/zh-cn/download'
    )
}
Write-Ok "node $nodeVersion"

$gitCommand = Get-Command -Name 'git' -CommandType Application -ErrorAction SilentlyContinue |
    Select-Object -First 1
if ($null -eq $gitCommand) {
    $gitCommand = Get-Command -Name 'git' -ErrorAction SilentlyContinue | Select-Object -First 1
}
if ($null -eq $gitCommand) {
    Fail '没有找到 git 命令：Git 未安装，或者安装了但没加入 PATH。' @(
        '下载安装：https://git-scm.com/download/win',
        '安装时保持默认选项即可（会一并安装 Git Credential Manager）。',
        '安装完成后关闭当前终端，重新打开再运行本脚本。',
        '自检命令：git --version'
    )
}
$GitExe = $gitCommand.Source
$gitVersion = Get-CommandVersion -Executable $GitExe
if ($null -eq $gitVersion) {
    Fail 'git 命令存在，但执行 git --version 失败。' @(
        '请重新安装 Git for Windows：https://git-scm.com/download/win'
    )
}
Write-Ok "$gitVersion"

# ============================================================ 2. 生成设计令牌
Write-Step '生成设计令牌：node scripts/build-tokens.mjs'

$previous = $ErrorActionPreference
try {
    $ErrorActionPreference = 'Continue'
    & $NodeExe $buildScript
    $buildExitCode = $LASTEXITCODE
} finally {
    $ErrorActionPreference = $previous
}

if ($buildExitCode -ne 0) {
    Fail '生成 src/styles/tokens.css 失败，先把 tokens/tokens.json 修好再运行本脚本。' @(
        '常见原因：JSON 语法错误、{引用} 指向不存在的 token、暗色 token 缺少对应的基础 token。',
        '排查方法：直接运行  node scripts/build-tokens.mjs  看具体报错行。',
        '令牌规则见：docs/01-设计令牌.md'
    )
}

$tokensCssPath = Join-Path $ProjectRoot 'src\styles\tokens.css'
if (-not (Test-Path -LiteralPath $tokensCssPath)) {
    Fail '生成命令执行成功，但没有找到 src\styles\tokens.css。' @(
        '请确认 scripts/build-tokens.mjs 没有被人为改动过。'
    )
}
$tokensCssSize = (Get-Item -LiteralPath $tokensCssPath).Length
Write-Ok "已生成 src/styles/tokens.css（$tokensCssSize 字节）"

# ============================================================ 3. 初始化 Git 仓库
Write-Step '检查 Git 仓库'

$gitDir = Join-Path $ProjectRoot '.git'
if (Test-Path -LiteralPath $gitDir) {
    Write-Ok '当前目录已经是 Git 仓库，跳过 git init'
} else {
    $initResult = Invoke-Git -Arguments @('init', '-b', 'main')
    if ($initResult.ExitCode -ne 0) {
        Write-Warn 'git init -b main 失败（Git 版本可能低于 2.28），改用兼容写法重试。'
        $fallbackInit = Invoke-Git -Arguments @('init')
        if ($fallbackInit.ExitCode -ne 0) {
            Fail 'git init 失败。' @(
                '请确认当前目录有写权限，且没有被杀毒软件/同步盘占用。',
                "目录：$ProjectRoot"
            )
        }
        $setBranch = Invoke-Git -Arguments @('symbolic-ref', 'HEAD', 'refs/heads/main')
        if ($setBranch.ExitCode -ne 0) {
            Fail '仓库已创建，但无法把默认分支设为 main。' @(
                '手动执行：git branch -M main'
            )
        }
    }
    Write-Ok '已初始化 Git 仓库，默认分支 main'
}

# 只写本仓库的配置：不碰全局。Windows 上默认可能把 LF 转成 CRLF，
# 会让 CI 里生成的文件和本地反复产生 diff。
Write-Step '设置仅本仓库的换行符策略（core.autocrlf=false）'
$configResult = Invoke-Git -Arguments @('config', '--local', 'core.autocrlf', 'false') -Quiet
if ($configResult.ExitCode -ne 0) {
    Fail '写入本仓库配置 core.autocrlf=false 失败。' @(
        '请检查 .git/config 是否可写（是否被杀毒软件锁定）。'
    )
}
$configCheck = Invoke-Git -Arguments @('config', '--local', 'core.autocrlf') -Capture -Quiet
$configValue = ($configCheck.Output -join '').Trim()
if ($configCheck.ExitCode -ne 0 -or $configValue -ne 'false') {
    Fail "本仓库 core.autocrlf 写入后读到的值不是 false（实际：$configValue）。" @(
        '手动执行：git config --local core.autocrlf false'
    )
}
Write-Ok '本仓库 core.autocrlf=false（全局配置未改动）'

# 有些环境（比如旧版 git init 或手动改过 HEAD）默认分支不是 main，这里兜底改名。
$branchResult = Invoke-Git -Arguments @('symbolic-ref', '--short', 'HEAD') -Capture -Quiet
$currentBranch = ($branchResult.Output -join '').Trim()
if ($branchResult.ExitCode -eq 0 -and $currentBranch -ne '' -and $currentBranch -ne 'main') {
    Write-Warn "当前分支是 $currentBranch，重命名为 main。"
    $renameResult = Invoke-Git -Arguments @('branch', '-M', 'main')
    if ($renameResult.ExitCode -ne 0) {
        $forceRef = Invoke-Git -Arguments @('symbolic-ref', 'HEAD', 'refs/heads/main')
        if ($forceRef.ExitCode -ne 0) {
            Fail '无法把当前分支切换为 main。' @('手动执行：git branch -M main')
        }
    }
    Write-Ok '当前分支已切换为 main'
}

# ============================================================ 4. 首次提交
Write-Step '创建首次提交（如果还没有提交）'

$hasCommit = Test-AnyCommit
if ($hasCommit) {
    Write-Ok '仓库已有提交，跳过自动提交（脚本不会替你写新的提交信息）'
    $statusResult = Invoke-Git -Arguments @('status', '--porcelain') -Capture -Quiet
    $dirtyFiles = @($statusResult.Output | Where-Object { $_.Trim() -ne '' })
    if ($dirtyFiles.Count -gt 0) {
        Write-Warn "工作区还有 $($dirtyFiles.Count) 个文件没提交（日常开发时这是正常状态）。"
        Write-Info '想提交它们：git add -A'
        Write-Info '            git commit -m "feat: 说明你改了什么"'
    } else {
        Write-Ok '工作区干净，没有待提交的修改'
    }
} else {
    $gitUserName = ((Invoke-Git -Arguments @('config', 'user.name') -Capture -Quiet).Output -join '').Trim()
    $gitUserEmail = ((Invoke-Git -Arguments @('config', 'user.email') -Capture -Quiet).Output -join '').Trim()
    if ([string]::IsNullOrEmpty($gitUserName) -or [string]::IsNullOrEmpty($gitUserEmail)) {
        Fail 'Git 还没有配置提交者姓名/邮箱，无法创建提交。' @(
            '配置一次即可（对所有仓库生效）：',
            '  git config --global user.name "你的名字"',
            '  git config --global user.email "你的邮箱@example.com"',
            '配置完重新运行本脚本。'
        )
    }
    Write-Info "提交者：$gitUserName <$gitUserEmail>"

    $addResult = Invoke-Git -Arguments @('add', '-A')
    if ($addResult.ExitCode -ne 0) {
        Fail 'git add -A 失败。' @('请查看上面的 git 报错信息。')
    }

    $stagedResult = Invoke-Git -Arguments @('diff', '--cached', '--name-only') -Capture -Quiet
    $stagedFiles = @($stagedResult.Output | Where-Object { $_.Trim() -ne '' })
    if ($stagedFiles.Count -eq 0) {
        Write-Warn '暂存区是空的，没有文件可以提交。'
        Write-Info '如果是被 .gitignore 全部排除了，请检查 .gitignore 内容。'
    } else {
        $commitResult = Invoke-Git -Arguments @('commit', '-m', 'chore: 初始化设计系统练习项目')
        if ($commitResult.ExitCode -ne 0) {
            Fail 'git commit 失败。' @(
                '常见原因：Git 身份未配置、有 hook 阻止提交、文件被其它程序占用。',
                '请按上面的 git 报错处理，然后重新运行本脚本。'
            )
        }
        Write-Ok "已创建首个提交，共 $($stagedFiles.Count) 个文件"
    }
}

# ============================================================ 5. 关联远程仓库并推送
$pagesUrl = $null
if (-not [string]::IsNullOrWhiteSpace($RepoUrl)) {
    Write-Step '关联 GitHub 远程仓库'

    $remoteUrl = $RepoUrl.Trim()
    if ($remoteUrl -notmatch '^(https?://|ssh://|git://|git@|file://)' -and
        $remoteUrl -notmatch '^([A-Za-z]:[\\/]|\\\\|\.{1,2}[\\/]|[\\/])') {
        Write-Warn "这个地址看起来不像 HTTPS / SSH 仓库地址：$remoteUrl"
        Write-Info '如果推送失败，请检查是不是漏了 https:// 或 git@ 前缀。'
    }

    $remoteList = Invoke-Git -Arguments @('remote') -Capture -Quiet
    $remoteNames = @($remoteList.Output | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne '' })
    if ($remoteNames -contains 'origin') {
        $setUrlResult = Invoke-Git -Arguments @('remote', 'set-url', 'origin', $remoteUrl) -Quiet
        if ($setUrlResult.ExitCode -ne 0) {
            Fail 'git remote set-url 失败。' @('手动执行：git remote set-url origin <仓库地址>')
        }
        Write-Ok "origin 已存在，地址已更新为：$remoteUrl"
    } else {
        $addRemoteResult = Invoke-Git -Arguments @('remote', 'add', 'origin', $remoteUrl) -Quiet
        if ($addRemoteResult.ExitCode -ne 0) {
            Fail 'git remote add origin 失败。' @(
                '先看看已有哪些远程仓库：git remote -v',
                '手动执行：git remote add origin <仓库地址>'
            )
        }
        Write-Ok "已添加 origin：$remoteUrl"
    }

    Write-Info '当前远程地址：'
    $remoteVerbose = Invoke-Git -Arguments @('remote', '-v') -Capture -Quiet
    foreach ($line in $remoteVerbose.Output) {
        if ($line.Trim() -ne '') { Write-Info "  $line" }
    }

    if ($remoteUrl -match '^https?://github\.com/(?<owner>[^/]+)/(?<repo>[^/]+?)(?:\.git)?/?$') {
        $pagesUrl = "https://$($Matches['owner']).github.io/$($Matches['repo'])/"
    } elseif ($remoteUrl -match '^git@github\.com:(?<owner>[^/]+)/(?<repo>[^/]+?)(?:\.git)?$') {
        $pagesUrl = "https://$($Matches['owner']).github.io/$($Matches['repo'])/"
    }

    if (-not (Test-AnyCommit)) {
        Write-Warn '仓库里还没有任何提交，跳过 git push。'
    } else {
        Write-Step '推送 main 到 origin'
        $pushResult = Invoke-Git -Arguments @('push', '-u', 'origin', 'main')
        if ($pushResult.ExitCode -ne 0) {
            Fail 'git push 失败，请按上面的报错对号入座。' @(
                '1) 认证失败 / 403：HTTPS 推送要用 Personal Access Token 当密码，或改用 SSH。',
                '   参考 docs/03-Git与GitHub.md 的「认证方式二选一」。',
                '2) 仓库不存在：先在 GitHub 创建空仓库，不要勾选 README / .gitignore / License。',
                '3) rejected non-fast-forward：远程已有提交，先 git pull --rebase origin main 再 push。',
                '4) 网络问题：检查代理、公司网络或 GitHub 是否可访问。'
            )
        }
        Write-Ok '已推送 main，并设置它跟踪 origin/main'
    }
}

# ============================================================ 6. 下一步指引
Write-Host ''
Write-Host '----------------------------------------------------------------' -ForegroundColor DarkGray
Write-Host ' 完成！接下来按顺序做这几件事' -ForegroundColor Cyan
Write-Host '----------------------------------------------------------------' -ForegroundColor DarkGray
Write-Host ''
Write-Host ' 1) 在 GitHub 创建仓库（如果还没创建）' -ForegroundColor White
Write-Host '    网页：https://github.com/new'
Write-Host '          仓库名填 design-system-lab，可见性选 Public，'
Write-Host '          不要勾选 Add a README / .gitignore / license（保持空仓库）。'
Write-Host '    命令行（需先安装 GitHub CLI）：'
Write-Host '          winget install --id GitHub.cli'
Write-Host '          gh auth login'
Write-Host '          gh repo create design-system-lab --public --source=. --remote=origin --push'
Write-Host ''
if ([string]::IsNullOrWhiteSpace($RepoUrl)) {
    Write-Host ' 2) 关联远程仓库并推送' -ForegroundColor White
    Write-Host '    把下面地址换成你自己的，然后逐行执行：'
    Write-Host '          git remote add origin https://github.com/<你的用户名>/design-system-lab.git'
    Write-Host '          git push -u origin main'
    Write-Host '    或者直接带参数重跑本脚本（幂等，不会重复提交）：'
    Write-Host '          pwsh -File scripts/bootstrap.ps1 -RepoUrl https://github.com/<你的用户名>/design-system-lab.git'
    Write-Host ''
} else {
    Write-Host ' 2) 远程仓库已关联并推送（上面已执行）' -ForegroundColor White
    Write-Host ''
}
Write-Host ' 3) 开启 GitHub Pages' -ForegroundColor White
Write-Host '    进入仓库：Settings → Pages → Build and deployment'
Write-Host '    把 Source 选择为 GitHub Actions（不要选 Deploy from a branch）。'
if ($null -ne $pagesUrl) {
    Write-Host "    站点地址预计是：$pagesUrl"
} else {
    Write-Host '    站点地址形如：https://<你的用户名>.github.io/design-system-lab/'
}
Write-Host ''
Write-Host ' 4) 看 Actions 跑起来' -ForegroundColor White
Write-Host '    仓库页面 → Actions 标签页：'
Write-Host '      Build tokens            改 tokens/** 时触发，校验/重新生成 tokens.css'
Write-Host '      Deploy to GitHub Pages  改 src/**、tokens/** 时触发，部署到 Pages'
Write-Host '    第一次部署要等 1~2 分钟，绿色对勾出现后刷新站点地址。'
Write-Host ''
Write-Host ' 5) 读一遍教程' -ForegroundColor White
Write-Host '    docs/03-Git与GitHub.md —— 认证、PR 练习、回滚、常见报错都在里面。'
Write-Host ''
Write-Host ' 提示：本脚本可以重复运行，已完成的步骤会自动跳过。' -ForegroundColor DarkGray
Write-Host ''

exit 0
