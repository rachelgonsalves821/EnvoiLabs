param()
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$target = [IO.Path]::GetFullPath((Join-Path $repo '.gate5-auth'))
if (-not $target.StartsWith($repo + [IO.Path]::DirectorySeparatorChar) -or
  (Split-Path $target -Leaf) -ne '.gate5-auth' -or (Test-Path -LiteralPath $target)) {
  throw 'Refusing unexpected disposable Auth target'
}
New-Item -ItemType Directory -Path (Join-Path $target 'supabase') -Force | Out-Null
try {
  $configSource = Join-Path $repo 'packages\db\scripts\auth-test-config.toml'
  $config = "project_id = `"gate5-auth`"`n`n" + (Get-Content -LiteralPath $configSource -Raw)
  Set-Content -LiteralPath (Join-Path $target 'supabase\config.toml') -Value $config
  Copy-Item -LiteralPath (Join-Path $repo 'packages\db\migrations') -Destination (Join-Path $target 'supabase') -Recurse
  Copy-Item -LiteralPath (Join-Path $repo 'packages\db\templates') -Destination (Join-Path $target 'supabase') -Recurse
  pnpm dlx supabase@2.84.2 start --workdir $target *> (Join-Path $target 'start.log')
  if ($LASTEXITCODE -ne 0) {
    Get-Content -LiteralPath (Join-Path $target 'start.log') -Tail 15
    throw 'Disposable Auth stack failed to start'
  }

  $status = pnpm dlx supabase@2.84.2 status --workdir $target --output env 2>$null
  $values = @{}
  foreach ($line in $status) {
    if ($line -match '^([A-Z_]+)=(.*)$') { $values[$Matches[1]] = $Matches[2].Trim('"') }
  }
  if ($values['API_URL'] -ne 'http://127.0.0.1:54321') { throw 'Not the disposable loopback API' }
  $publishable = if ($values['PUBLISHABLE_KEY']) { $values['PUBLISHABLE_KEY'] } else { $values['ANON_KEY'] }
  $service = if ($values['SERVICE_ROLE_KEY']) { $values['SERVICE_ROLE_KEY'] } else { $values['SECRET_KEY'] }
  if (-not $publishable -or -not $service) { throw 'Disposable Auth keys unavailable' }

  Get-Content -LiteralPath (Join-Path $repo 'packages\db\seed.sql') -Raw |
    docker exec -i supabase_db_gate5-auth psql -U postgres -d postgres -v ON_ERROR_STOP=1 *> (Join-Path $target 'seed.log')
  if ($LASTEXITCODE -ne 0) { throw 'Fictional seed failed' }
  Get-Content -LiteralPath (Join-Path $repo 'apps\web\e2e\fixtures\gate5-qualified-report.sql') -Raw |
    docker exec -i supabase_db_gate5-auth psql -U postgres -d postgres -v ON_ERROR_STOP=1 *> (Join-Path $target 'report.log')
  if ($LASTEXITCODE -ne 0) {
    Get-Content -LiteralPath (Join-Path $target 'report.log') -Tail 15
    throw 'Fictional report fixture failed'
  }

  $env:SUPABASE_URL = $values['API_URL']
  $env:SUPABASE_PUBLISHABLE_KEY = $publishable
  $env:SUPABASE_SERVICE_ROLE_KEY = $service
  $env:ENVOI_APP_ORIGIN = 'http://127.0.0.1:3100'
  $env:ENVOI_TEST_LOCAL_SUPABASE = '1'
  $env:ENVOI_GATE5_REPORT_FIXTURE = '1'
  $env:NEXT_TELEMETRY_DISABLED = '1'
  Push-Location $repo
  try {
    pnpm exec playwright test --project=desktop-chromium --retries=0 --workers=1 gate5-report.spec.ts
    if ($LASTEXITCODE -ne 0) { throw 'Gate 5 signed-in report browser test failed' }
  } finally { Pop-Location }
} finally {
  pnpm dlx supabase@2.84.2 stop --workdir $target --no-backup | Out-Null
  if ((Test-Path -LiteralPath $target) -and
    $target.StartsWith($repo + [IO.Path]::DirectorySeparatorChar) -and
    (Split-Path $target -Leaf) -eq '.gate5-auth') {
    Remove-Item -LiteralPath $target -Recurse -Force
  }
  Write-Output "Disposable Auth directory remains: $(Test-Path -LiteralPath $target)"
}
