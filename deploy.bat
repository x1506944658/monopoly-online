@echo off
chcp 65001 >nul 2>&1
title 大富翁联机版 - 一键部署到 Railway
color 0B
cd /d "%~dp0"

echo.
echo  ============================================================
echo             大富翁联机版 - 一键部署到 Railway
echo  ============================================================
echo   这个脚本会帮你把游戏部署到公网，朋友点链接就能玩。
echo   全程不需要 GitHub Token，只需要在浏览器里点授权。
echo  ============================================================
echo.

echo  [1/5] 检查 Node.js ...
where node >nul 2>&1
if errorlevel 1 (
    echo  [X] 没有找到 Node.js！
    echo      请先安装：https://nodejs.org （选 LTS 版本）
    echo      安装时勾选 "Add to PATH"，装完重新运行本脚本
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('node --version') do echo  [OK] Node.js %%v

echo.
echo  [2/5] 安装 Railway CLI （首次需要几十秒，请等待）...
call npm install @railway/cli@latest 2>nul
if exist "node_modules\.bin\railway.cmd" (
    echo  [OK] Railway CLI 安装成功
) else (
    echo  [提示] 本地安装失败，改用在线模式...
)

echo.
echo  [3/5] 登录 Railway ...
echo  ------------------------------------------------------------
echo   浏览器会自动打开 Railway 授权页面
echo   - 没有账号：点 "Sign up" 用 GitHub 注册（30秒，免费）
echo   - 已有账号：直接登录
echo   - 登录后点 "Authorize Railway"
echo  ------------------------------------------------------------
echo.
pause
if exist "node_modules\.bin\railway.cmd" (
    call node_modules\.bin\railway.cmd login
) else (
    call npx -y @railway/cli@latest login
)

echo.
echo  [4/5] 创建项目 ...
echo  ------------------------------------------------------------
echo   会弹出几个选择，按下面选：
echo     1. "What would you like to do?"
echo        选 "Create a new project" （方向键选，回车确认）
echo     2. "Select a starting point"
echo        选 "Empty project"
echo     3. "Enter project name"
echo        输入 monopoly-online 回车
echo  ------------------------------------------------------------
echo.
pause
if exist "node_modules\.bin\railway.cmd" (
    call node_modules\.bin\railway.cmd init
) else (
    call npx -y @railway/cli@latest init
)

echo.
echo  [5/5] 部署到公网 ...
echo  正在上传代码，请等待...
if exist "node_modules\.bin\railway.cmd" (
    call node_modules\.bin\railway.cmd up
) else (
    call npx -y @railway/cli@latest up
)

echo.
echo  ============================================================
echo   部署完成！
echo.
echo   获取你的公网游戏链接：
echo     1. 打开 https://railway.com
echo     2. 点左上角你的项目 monopoly-online
echo     3. 点 Settings 标签页
echo     4. 找到 Networking 区域
echo     5. 点 "Generate Domain"
echo     6. 出现的 xxx.up.railway.app 就是你的游戏地址！
echo.
echo   把这个链接发给朋友，他们打开就能在线对战了。
echo  ============================================================
echo.
pause
