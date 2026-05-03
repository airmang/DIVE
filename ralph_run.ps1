# DIVE Ralph 루프 실행 스크립트 (Windows PowerShell)
# ChatGPT 구독 기반 codex CLI 사용
# 사용: .\ralph_run.ps1

$ErrorActionPreference = 'Stop'

$specDir = $PSScriptRoot
$promptFile = Join-Path $specDir 'RALPH_PROMPT.md'
$nextFile = Join-Path $specDir 'DIVE_NEXT.md'
$logDir = Join-Path $specDir 'ralph_logs'
New-Item -ItemType Directory -Path $logDir -Force | Out-Null

Write-Host "DIVE Ralph 루프 시작 — $(Get-Date)"
Write-Host "프롬프트: $promptFile"
Write-Host "로그: $logDir"
Write-Host ""

function Test-ShouldStop {
    if (-not (Test-Path $nextFile)) { return $false }
    $content = Get-Content $nextFile -Raw

    if ($content -match '^\[PHASE_GATE\]') {
        Write-Host ""
        Write-Host "🛑 Phase 게이트에 도달했습니다. 사용자 확인이 필요합니다." -ForegroundColor Yellow
        Write-Host "   $nextFile 를 확인하세요."
        return $true
    }
    if ($content -match '^상태: \[BLOCKED\]') {
        Write-Host ""
        Write-Host "🛑 작업이 차단되었습니다 (BLOCKED). 사용자 결정이 필요합니다." -ForegroundColor Yellow
        Write-Host "   $nextFile 의 '사용자에게 묻고 싶은 것' 섹션을 확인하세요."
        return $true
    }
    return $false
}

$turn = 1
while ($true) {
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    Write-Host "턴 $turn — $(Get-Date -Format 'HH:mm:ss')"
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    if (Test-ShouldStop) { break }

    # 현재 작업 표시
    if (Test-Path $nextFile) {
        Get-Content $nextFile -TotalCount 5 | ForEach-Object { Write-Host "  $_" }
    }
    Write-Host ""

    # 로그 파일
    $logFile = Join-Path $logDir ("turn_{0:D4}_{1}.log" -f $turn, (Get-Date -Format 'yyyyMMdd_HHmmss'))

    # codex 호출 — 환경에 맞게 조정
    # ChatGPT 구독 기반이면 OAuth 인증 후 다음과 비슷:
    Get-Content $promptFile -Raw | codex --model gpt-5.2-codex --working-dir (Split-Path $specDir -Parent) 2>&1 | Tee-Object -FilePath $logFile

    if (Test-ShouldStop) { break }

    Start-Sleep -Seconds 5
    $turn++

    if ($turn -gt 1000) {
        Write-Host "🛑 1000턴 초과. 사용자 점검을 위해 정지합니다." -ForegroundColor Yellow
        break
    }
}
