param(
    [string]$EnvFile = ".env.prod"
)

$ErrorActionPreference = "Stop"

# 只做静态生产配置检查，不启动、不停止容器，不输出任何密钥值。
if (-not (Test-Path -LiteralPath $EnvFile)) {
    throw "找不到 $EnvFile；请先复制 .env.prod.example 并填写生产值。"
}

$values = @{}
Get-Content -LiteralPath $EnvFile -Encoding UTF8 | ForEach-Object {
    if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') {
        $values[$matches[1]] = $matches[2].Trim()
    }
}

$required = @(
    'APP_NAME', 'APP_ENV', 'APP_PORT', 'APP_BIND', 'APP_ENV_FILE', 'APP_SECRET',
    'POSTGRES_DB', 'POSTGRES_USER', 'POSTGRES_PASSWORD', 'DATABASE_URL',
    'NEO4J_URI', 'NEO4J_USER', 'NEO4J_PASSWORD', 'NEO4J_BIND',
    'ADMIN_USERNAME', 'ADMIN_INITIAL_PASSWORD', 'SEED_DEMO', 'DEMO_MODE',
    'DEFAULT_TENANT', 'TENANT_NAME'
)
$missing = $required | Where-Object { -not $values.ContainsKey($_) -or [string]::IsNullOrWhiteSpace($values[$_]) }
if ($missing) {
    throw "缺少生产配置项：$($missing -join ', ')"
}

function Assert-Value([string]$Name, [bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw "$Name 检查失败：$Message" }
}

function Has-Placeholder([string]$Value) {
    return $Value -match '(__CHANGE_ME__|CHANGE_ME|change-me|dev-only|GENERATE_AT_LEAST)'
}

Assert-Value 'APP_ENV' ($values['APP_ENV'] -eq 'prod') '必须为 prod'
Assert-Value 'APP_PORT' ($values['APP_PORT'] -eq '8001') '端口固定为 8001'
Assert-Value 'APP_ENV_FILE' ($values['APP_ENV_FILE'] -eq '.env.prod') '必须为 .env.prod'
Assert-Value 'DEMO_MODE' ($values['DEMO_MODE'] -match '^(false|0|no|off)$') '生产必须关闭演示自动登录'
Assert-Value 'SEED_DEMO' ($values['SEED_DEMO'] -match '^(false|0|no|off)$') '生产禁止导入演示数据'
Assert-Value 'DEFAULT_TENANT' ($values['DEFAULT_TENANT'] -ne 't_demo') '不能沿用演示租户 t_demo'
Assert-Value 'APP_SECRET' ($values['APP_SECRET'].Length -ge 32 -and -not (Has-Placeholder $values['APP_SECRET'])) '至少 32 位且不能是占位值'
Assert-Value 'POSTGRES_PASSWORD' ($values['POSTGRES_PASSWORD'].Length -ge 12 -and $values['POSTGRES_PASSWORD'] -ne 'kbpass' -and -not (Has-Placeholder $values['POSTGRES_PASSWORD'])) '至少 12 位且不能使用默认值'
Assert-Value 'NEO4J_PASSWORD' ($values['NEO4J_PASSWORD'].Length -ge 12 -and $values['NEO4J_PASSWORD'] -ne 'neo4jpass' -and -not (Has-Placeholder $values['NEO4J_PASSWORD'])) '至少 12 位且不能使用默认值'
Assert-Value 'ADMIN_INITIAL_PASSWORD' ($values['ADMIN_INITIAL_PASSWORD'].Length -ge 12 -and $values['ADMIN_INITIAL_PASSWORD'] -ne 'Admin@12345' -and -not (Has-Placeholder $values['ADMIN_INITIAL_PASSWORD'])) '至少 12 位且不能使用默认值'
Assert-Value 'DATABASE_URL' ($values['DATABASE_URL'] -match '@db:5432/' -and $values['DATABASE_URL'] -notmatch 'kbpass|CHANGE_ME') '必须指向 db:5432 且不能包含默认/占位密码'

$allowPublic = $values.ContainsKey('ALLOW_PUBLIC_BIND') -and $values['ALLOW_PUBLIC_BIND'] -match '^(true|1|yes|on)$'
foreach ($name in @('APP_BIND', 'NEO4J_BIND')) {
    $bind = $values[$name]
    $isLoopback = $bind -in @('127.0.0.1', '::1', 'localhost')
    Assert-Value $name ($isLoopback -or $allowPublic) "生产默认只允许回环地址；若确需公网绑定，设置 ALLOW_PUBLIC_BIND=true 并自行配置防火墙"
}

$modelUrl = $values['MODEL_BASE_URL']
$modelKey = $values['MODEL_API_KEY']
if ([string]::IsNullOrWhiteSpace($modelUrl) -xor [string]::IsNullOrWhiteSpace($modelKey)) {
    throw 'MODEL_BASE_URL 与 MODEL_API_KEY 必须同时填写或同时留空'
}
if ([string]::IsNullOrWhiteSpace($modelUrl) -and [string]::IsNullOrWhiteSpace($modelKey)) {
    Write-Warning '模型 Key 未配置：当前会使用检索式降级回答，不是真实大模型生成。'
}
Write-Warning 'OCR 尚未接入：图片型 PDF 仍需后续完成 Tesseract/视觉模型解析。'

$composeOutput = & docker compose -p kb --env-file $EnvFile -f docker-compose.yml -f docker-compose.prod.yml config --quiet 2>&1
if ($LASTEXITCODE -ne 0) {
    throw "生产 Compose 配置校验失败：$($composeOutput -join ' ')"
}

Write-Host 'PROD_PREFLIGHT=PASS'
Write-Host "env_file=$EnvFile compose=docker-compose.yml+docker-compose.prod.yml"
