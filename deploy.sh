#!/bin/bash
# 大富翁联机版 - 一键部署到 Railway (macOS / Linux / Git Bash on Windows)
set -e
RW="npx -y @railway/cli@latest"

cd "$(dirname "$0")"

echo ""
echo "  ╔══════════════════════════════════════════════════════════╗"
echo "  ║          大富翁联机版 - 一键部署到 Railway               ║"
echo "  ╠══════════════════════════════════════════════════════════╣"
echo "  ║  朋友点链接就能在线对战，全程不需要 GitHub Token        ║"
echo "  ╚══════════════════════════════════════════════════════════╝"
echo ""

# ──────────────────────────────────────
# [1/4] 检查 Node.js
# ──────────────────────────────────────
echo "  [1/4] 检查 Node.js ..."
if ! command -v node &>/dev/null; then
    echo "  [错误] 没有找到 Node.js！请先安装 LTS 版本：https://nodejs.org"
    exit 1
fi
echo "  [OK] Node.js $(node --version)"
NVMAJOR=$(node --version | sed 's/v//' | cut -d. -f1)
if [ "$NVMAJOR" -lt 18 ]; then
    echo "  [!] 建议升级到 Node.js v18+：https://nodejs.org"
fi

# ──────────────────────────────────────
# [2/4] 准备依赖清单
# ──────────────────────────────────────
echo ""
echo "  [2/4] 准备项目依赖清单 ..."
if [ ! -f package-lock.json ]; then
    npm install --package-lock-only --no-audit --no-fund >/dev/null 2>&1 || true
fi
if [ -f package-lock.json ]; then
    echo "  [OK] package-lock.json 就绪"
else
    echo "  [提示] 未生成 package-lock.json，仍可继续部署（Railway 自动安装）"
fi

# ──────────────────────────────────────
# [3/4] 登录 Railway
# ──────────────────────────────────────
echo ""
echo "  [3/4] 登录 Railway ..."
echo "  ┌──────────────────────────────────────────────────────────┐"
echo "  │  浏览器会打开 Railway 授权页面：                         │"
echo "  │  • 没账号：Sign up 用 GitHub 注册（30 秒，免费）         │"
echo "  │  • 有账号：直接登录                                      │"
echo "  │  • 登录后点 Authorize Railway                            │"
echo "  └──────────────────────────────────────────────────────────┘"
echo ""
read -r -p "  按回车打开浏览器登录..." _t
$RW login
echo "  [OK] 登录成功"

# ──────────────────────────────────────
# [4/4] 创建项目 + 部署
# ──────────────────────────────────────
echo ""
echo "  [4/4] 创建项目并部署..."
echo "  提示：接下来会弹出选项，按下面选择："
echo "    1) What would you like to do?  →  Create a new project"
echo "    2) Select a starting point     →  Empty Project"
echo "    3) Enter project name          →  monopoly-online"
echo ""
read -r -p "  按回车开始..." _t

if [ -d .railway ]; then
    echo "  检测到已存在 .railway 目录，尝试链接到既有项目"
    $RW status || true
else
    $RW init --name "monopoly-online"
fi

echo ""
echo "  上传代码并部署（约 30-90 秒）..."
$RW up --detach || $RW deploy --detach

echo ""
echo "  ═══════════════════════════════════════════════════════════"
echo "  部署命令已发出！部署进行中（1-2 分钟）..."
echo ""
echo "  👉 获取游戏公网链接："
echo "    1. 打开 https://railway.com/dashboard"
echo "    2. 点击 monopoly-online 项目卡片"
echo "    3. 顶部黄色进度条完成 → 点 View Domain"
echo "       或进入 Settings → Networking → Generate Domain"
echo "    4. xxx.up.railway.app 就是游戏公网地址"
echo ""
echo "  🎮 联机玩法："
echo "    1. 把 xxx.up.railway.app 发给朋友"
echo "    2. 你打开 → 🌐在线对战 → 创建房间"
echo "    3. 复制邀请链接 (?room=XXXXX) 发给朋友"
echo "    4. 他们打开自动加入"
echo "    5. 人齐点开始游戏即可"
echo ""
echo "  🧪 本地自测（无需部署）："
echo "      npm install && node server.js"
echo "      浏览器开两个 http://localhost:3000 标签页"
echo "      一个建房一个加入即可测试联机"
echo "  ═══════════════════════════════════════════════════════════"
