@echo off
chcp 65001 >nul 2>&1
title 大富翁联机版 - 一键部署到 Railway
color 0B
cd /d "%~dp0"

set "RW=npx -y @railway/cli@latest"

echo.
echo  ============================================================
echo             大富翁联机版 - 一键部署到 Railway
echo  ============================================================
echo   这个脚本会帮你把游戏部署到公网，朋友点链接就能玩。
echo   部署完成后，你会获得一个 xxx.up.railway.app 公网地址。
echo   全程不需要 GitHub Token，只需要在浏览器里点授权。
echo  ============================================================
echo.

:: ──────────────────────────────────────
:: [1/5] 检查 Node.js
:: ──────────────────────────────────────
echo  [1/5] 检查 Node.js ...
where node >nul 2>&1
if errorlevel 1 (
    echo.
    echo  [X] 没有找到 Node.js！
    echo      请先安装 LTS 版本：https://nodejs.org
    echo      安装时务必勾选 "Add to PATH"
    echo      装完关闭本窗口，重新运行 deploy.bat
    echo.
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('node --version') do echo  [OK] Node.js %%v
:: 建议版本检查
for /f "tokens=1 delims=." %%m in ('node --version') do set NVMAJOR=%%m
set "NVMAJOR=%NVMAJOR:v=%"
if %NVMAJOR% LSS 18 (
    echo  [!] 你当前的 Node.js 版本偏低，建议升级到 v18 或以上：https://nodejs.org
)

:: ──────────────────────────────────────
:: [2/5] 检查 package-lock 以便 Railway 正确安装依赖
:: ──────────────────────────────────────
echo.
echo  [2/5] 准备项目依赖清单 ...
if not exist "package-lock.json" (
    echo  正在生成 package-lock.json（首次需要几秒）...
    call npm install --package-lock-only --no-audit --no-fund >nul 2>&1
)
if exist "package-lock.json" (
    echo  [OK] package-lock.json 就绪
) else (
    echo  [提示] 未找到 package-lock.json，仍可继续部署（Railway 会自动安装）
)

:: ──────────────────────────────────────
:: [3/5] 登录 Railway
:: ──────────────────────────────────────
echo.
echo  [3/5] 登录 Railway ...
echo  ------------------------------------------------------------
echo   即将打开浏览器授权页面：
echo   - 没有账号：点 "Sign up" 用 GitHub 注册（30 秒，免费）
echo   - 已有账号：直接登录
echo   - 登录后点页面上的 "Authorize Railway" 按钮
echo   - 授权完成后回到本窗口继续
echo  ------------------------------------------------------------
echo.
pause

%RW% login
if errorlevel 1 (
    echo.
    echo  [X] 登录失败，请重试或检查网络
    pause
    exit /b 1
)
echo  [OK] 登录成功

:: ──────────────────────────────────────
:: [4/5] 创建/链接 Railway 项目
:: ──────────────────────────────────────
echo.
echo  [4/5] 创建 Railway 项目 ...
echo  ------------------------------------------------------------
echo   如果提示选择：
echo     1. What would you like to do?
echo        方向键选 "Create a new project"，回车
echo     2. Select a starting point
echo        方向键选 "Empty Project"，回车
echo     3. Enter project name
echo        输入 monopoly-online，回车
echo  ------------------------------------------------------------
echo.
pause

if exist ".railway" (
    echo  检测到已存在 .railway 目录，将尝试链接到既有项目...
    %RW% status
) else (
    %RW% init --name "monopoly-online"
)
if errorlevel 1 (
    echo.
    echo  [!] 初始化似乎被中断。如果已成功创建项目则忽略，可直接下一步。
)

:: ──────────────────────────────────────
:: [5/5] 上传并部署
:: ──────────────────────────────────────
echo.
echo  [5/5] 部署到公网 ...
echo  正在上传代码并构建（约 30 - 90 秒，请耐心等待）...
echo.

%RW% up --detach
if errorlevel 1 (
    echo  [!] railway up 不可用，尝试 deploy 命令...
    %RW% deploy --detach
)

echo.
echo ============================================================
echo    部署命令已发出！
echo.
echo    部署中（一般 1-2 分钟完成）。获取你的公网游戏链接：
echo.
echo    方法 A（推荐·一键）：在浏览器打开 Railway 控制台
echo      1. 访问 https://railway.com/dashboard
echo      2. 点击 monopoly-online 项目卡片
echo      3. 页面顶部出现的黄色进度条完成后，点击 "View Domain"
echo         或到 Settings 标签页 -^> Networking
echo      4. 点 "Generate Domain"（如果还没生成）
echo      5. 出现的 xxx.up.railway.app 就是游戏地址！
echo.
echo    方法 B（命令行·查看项目）：
echo      在本目录运行：  %RW% open
echo.
echo    怎么联机玩：
echo      1. 把 xxx.up.railway.app 链接发给朋友
echo      2. 你打开链接 → 🌐 在线对战 → 创建房间
echo      3. 复制生成的邀请链接（?room=XXXXX）发给朋友
echo      4. 他们打开链接 → 自动加入房间
echo      5. 人齐后房主点 "开始游戏" 即可对战
echo.
echo    本地测试（不需要部署）：
echo      在本目录打开 cmd / PowerShell：
echo        npm install
echo        node server.js
echo      然后浏览器打开 http://localhost:3000
echo      开两个标签页就能测联机（一个当房主，一个当客机）
echo ============================================================
echo.
pause
