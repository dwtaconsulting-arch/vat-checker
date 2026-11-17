# 브라우저 테스트 실행 (Edge 헤드리스). 사용: powershell -File tools\run-web-tests.ps1
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$edge = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe") |
    Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $edge) { throw "Microsoft Edge를 찾을 수 없습니다" }
$page = Join-Path $root "web\tests\test.html"
$url = "file:///" + ($page -replace '\\', '/')
$profile = Join-Path $env:TEMP "vat-web-tests-edge"
# Edge는 무해한 경고를 stderr로 내보내므로 이 호출만 오류 중단을 끈다
$ErrorActionPreference = "Continue"
$dom = & $edge --headless=new --disable-gpu --allow-file-access-from-files --user-data-dir="$profile" --virtual-time-budget=120000 --dump-dom "$url" 2>$null | Out-String
$ErrorActionPreference = "Stop"
$m = [regex]::Match($dom, '<pre id="out">([\s\S]*?)</pre>')
if (-not $m.Success) { Write-Output $dom; exit 2 }
$text = [System.Net.WebUtility]::HtmlDecode($m.Groups[1].Value)
Write-Output $text
if ($text -match 'RESULT pass=\d+ fail=0') { exit 0 } else { exit 1 }
