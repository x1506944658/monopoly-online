#!/bin/bash
# 大富翁联机版 - 一键部署到 Railway (macOS/Linux/Git Bash)
set -e

echo ""
echo "  ╔══════════════════════════════════════════════════════════╗"
echo "  ║          大富翁联机版 - 一键部署到 Railway               ║"
echo "  ╠══════════════════════════════════════════════════════════╣"
echo "  ║  朋友点链接就能在线对战，全程不需要 GitHub Token        ║"
echo "  ╚══════════════════════════════════════════════════════════╝"
echo ""

echo "  [1/4] 检查 Node.js ..."
if ! command -v node &>/dev/null; then
    echo "  [错误] 没有找到 Node.js！请先安装：https://nodejs.org"
    exit 1
fi
echo "  [OK] Node.js $(node --version)"

echo ""
echo "  [2/4] 安装 Railway CLI ..."
npx -y @railway/cli@latest version

echo ""
echo "  [3/4] 登录 Railway（会打开浏览器，点 Authorize 即可）..."
echo "  ┌──────────────────────────────────────────────────────────┐"
echo "  │  浏览器会自动打开 Railway 授权页面                       │"
echo "  │  没有账号就点 Sign up 用 GitHub 注册（30秒，免费）       │"
echo "  │  登录后点 Authorize Railway                              │"
echo "  └──────────────────────────────────────────────────────────┘"
echo ""
read -p "  按回车键打开浏览器登录..."
npx -y @railway/cli@latest login

echo ""
echo "  [4/4] 创建项目并部署..."
echo "  接下来选择 Create a new project → Empty project"
echo "  项目名输入 monopoly-online 回车"
echo ""
read -p "  按回车键开始..."
npx -y @railway/cli@latest init
npx -y @railway/cli@latest up --detach

echo ""
echo "  ═══════════════════════════════════════════════════════════"
echo "  部署中... 约 1-2 分钟后游戏上线"
echo "  获取公网链接："
echo "    打开 https://railway.com → 你的项目 → Settings → Networking"
echo "    点 Generate Domain 获取公网链接"
echo "  ═══════════════════════════════════════════════════════════"
