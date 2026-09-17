# フロントエンドとバックエンドの開発サーバーをまとめて起動する。
# 使い方: .\scripts\dev.ps1
# Ctrl+C で両方まとめて停止する。
#
# このファイルは UTF-8 BOM付き で保存する。BOMを外さないこと。
# Windows PowerShell 5.1 は BOM のないスクリプトを ANSI（日本語環境ではCP932）として
# 読むため、BOMを外すとこのファイルの日本語が壊れて構文エラーになる。

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$ErrorActionPreference = "Stop"

# スクリプトの場所からリポジトリのルートを決める。
# 実行時のカレントディレクトリに依存させないため。
$root = Split-Path -Parent $PSScriptRoot
$frontendDir = Join-Path $root "frontend"
$backendDir = Join-Path $root "backend"

function Get-CommandPath {
    param([string]$Name)
    $found = Get-Command $Name -ErrorAction SilentlyContinue
    if ($null -eq $found) { return $null }
    return $found.Source
}

# 起動前に前提を確かめる。途中で片方だけ落ちる状態を避けるため。
$goPath = Get-CommandPath "go"
if ($null -eq $goPath) {
    Write-Host "Goが見つかりません。Go 1.26以上をインストールしてPATHに追加してください。" -ForegroundColor Red
    exit 1
}

# Windowsではnpmの実体がnpm.cmdのため、そちらを優先して探す。
$npmPath = Get-CommandPath "npm.cmd"
if ($null -eq $npmPath) { $npmPath = Get-CommandPath "npm" }
if ($null -eq $npmPath) {
    Write-Host "npmが見つかりません。Node.js 24.14以上をインストールしてPATHに追加してください。" -ForegroundColor Red
    exit 1
}

if (-not (Test-Path (Join-Path $frontendDir "node_modules"))) {
    Write-Host "frontend/node_modules がありません。先に依存をインストールしてください:" -ForegroundColor Red
    Write-Host "  cd frontend" -ForegroundColor Yellow
    Write-Host "  npm.cmd ci" -ForegroundColor Yellow
    exit 1
}

# DATABASE_URL がなくても生成・ゲスト機能は動く。保存APIだけが503を返す。
if ([string]::IsNullOrWhiteSpace($env:DATABASE_URL)) {
    Write-Host "DATABASE_URL が未設定です。生成とゲスト機能は動きますが、保存APIは503を返します。" -ForegroundColor DarkYellow
}

$processes = @()

function Stop-DevProcesses {
    foreach ($p in $processes) {
        if ($null -eq $p) { continue }
        if ($p.HasExited) { continue }
        # go run や npm は子プロセスを持つため、プロセスツリーごと止める。
        # 親だけ止めると、ビルド済みバイナリやViteが残ってポートを掴み続ける。
        & taskkill.exe /PID $p.Id /T /F *> $null
    }
}

try {
    Write-Host ""
    Write-Host "開発サーバーを起動します。停止するには Ctrl+C を押してください。" -ForegroundColor Cyan
    Write-Host ""

    $backend = Start-Process -FilePath $goPath -ArgumentList "run", "./cmd/api" `
        -WorkingDirectory $backendDir -NoNewWindow -PassThru
    $processes += $backend
    Write-Host "[backend]  go run ./cmd/api を起動しました (PID $($backend.Id))" -ForegroundColor Green

    $frontend = Start-Process -FilePath $npmPath -ArgumentList "run", "dev" `
        -WorkingDirectory $frontendDir -NoNewWindow -PassThru
    $processes += $frontend
    Write-Host "[frontend] npm run dev を起動しました (PID $($frontend.Id))" -ForegroundColor Green

    Write-Host ""
    Write-Host "  フロントエンド: http://localhost:5173" -ForegroundColor Cyan
    Write-Host "  API:            http://localhost:8080/api/v1/health" -ForegroundColor Cyan
    Write-Host ""

    # どちらかが落ちたら、もう片方も止める。
    # 片方だけ生き残ると、動いているつもりで壊れた状態を触ることになる。
    while (-not ($backend.HasExited -or $frontend.HasExited)) {
        Start-Sleep -Milliseconds 500
    }

    if ($backend.HasExited) {
        Write-Host ""
        Write-Host "[backend] が終了しました (終了コード $($backend.ExitCode))。フロントエンドも停止します。" -ForegroundColor Yellow
    }
    if ($frontend.HasExited) {
        Write-Host ""
        Write-Host "[frontend] が終了しました (終了コード $($frontend.ExitCode))。バックエンドも停止します。" -ForegroundColor Yellow
    }
}
finally {
    Stop-DevProcesses
    Write-Host "開発サーバーを停止しました。" -ForegroundColor Cyan
}
