param(
    [switch]$Yes
)

# 清空演示业务数据并重新播种；仅用于本机/演示环境，生产禁止执行。
if (-not $Yes) {
    Write-Host "该操作会清空 kb 项目的演示数据（租户/用户/会话/知识库），然后重启 app 与 worker 重新播种。"
    Write-Host "确认请重新执行： .\scripts\reset_demo.ps1 -Yes"
    exit 1
}

$ErrorActionPreference = "Stop"
docker compose -p kb exec -T redis redis-cli FLUSHDB | Out-Null
docker compose -p kb exec -T db psql -U kb -d kb -c "TRUNCATE TABLE tenants RESTART IDENTITY CASCADE;" | Out-Null
docker compose -p kb up -d --force-recreate app worker | Out-Null

$deadline = (Get-Date).AddSeconds(60)
while ((Get-Date) -lt $deadline) {
    try {
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:8001/health" -TimeoutSec 3
        if ($health.status -eq "ok") {
            Write-Host "演示数据已重置：$($health.status) / $($health.checks | ConvertTo-Json -Compress)"
            exit 0
        }
    } catch {
    }
    Start-Sleep -Seconds 2
}
throw "重置后健康检查未通过"
