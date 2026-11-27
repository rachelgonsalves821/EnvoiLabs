param(
  [ValidateSet('gate5-report.spec.ts', 'gate2-marketplace.spec.ts',
    'researcher/gate3-report.spec.ts')][string]$Spec = 'gate5-report.spec.ts',
  [ValidateSet('desktop-chromium', 'mobile-webkit')][string]$Project = 'desktop-chromium',
  [ValidateSet('withdrawal', 'reredaction', 'deletion', 'newest-withheld',
    'source-unqualified')]
    [string]$Scenario = 'withdrawal',
  [switch]$FullWalkthrough,
  [switch]$MobileTrace
)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$target = [IO.Path]::GetFullPath((Join-Path $repo '.gate5-auth'))
$projectId = 'gate5-auth-' + [guid]::NewGuid().ToString('N').Substring(0, 8)
$dbContainer = 'supabase_db_' + $projectId
$cliCache = Join-Path $env:USERPROFILE 'AppData\Local\pnpm-cache\dlx'
$supabaseCli = Get-ChildItem -LiteralPath $cliCache -Filter 'supabase.CMD' -Recurse -File -ErrorAction SilentlyContinue |
  Where-Object FullName -Match 'node_modules\\.bin\\supabase.CMD$' |
  Select-Object -First 1 -ExpandProperty FullName
if (-not $supabaseCli -or (& $supabaseCli --version) -ne '2.84.2') {
  throw 'Cached Supabase CLI 2.84.2 is unavailable'
}
if (-not $target.StartsWith($repo + [IO.Path]::DirectorySeparatorChar) -or
  (Split-Path $target -Leaf) -ne '.gate5-auth' -or (Test-Path -LiteralPath $target)) {
  throw 'Refusing unexpected disposable Auth target'
}
if ($FullWalkthrough -and $Spec -ne 'gate2-marketplace.spec.ts') {
  throw 'Full walkthrough mode requires the fictional marketplace browser case'
}
if ($MobileTrace -and -not $FullWalkthrough) {
  throw 'Mobile diagnostic requires the fictional full walkthrough fixture'
}
if ($Scenario -eq 'source-unqualified' -and $Spec -ne 'researcher/gate3-report.spec.ts') {
  throw 'Private sentinel fixture requires the local-only Gate 3 mounted case'
}
New-Item -ItemType Directory -Path (Join-Path $target 'supabase') -Force | Out-Null
try {
  $configSource = Join-Path $repo 'packages\db\scripts\auth-test-config.toml'
  $config = "project_id = `"$projectId`"`n`n" + (Get-Content -LiteralPath $configSource -Raw)
  Set-Content -LiteralPath (Join-Path $target 'supabase\config.toml') -Value $config
  Copy-Item -LiteralPath (Join-Path $repo 'packages\db\migrations') -Destination (Join-Path $target 'supabase') -Recurse
  Copy-Item -LiteralPath (Join-Path $repo 'packages\db\templates') -Destination (Join-Path $target 'supabase') -Recurse
  $ErrorActionPreference = 'Continue'
  & $supabaseCli start --workdir $target --exclude storage-api,imgproxy,vector,logflare *> (Join-Path $target 'start.log')
  $ErrorActionPreference = 'Stop'
  if ($LASTEXITCODE -ne 0) {
    Get-Content -LiteralPath (Join-Path $target 'start.log') -Tail 15
    throw 'Disposable Auth stack failed to start'
  }

  $ErrorActionPreference = 'Continue'
  $status = & $supabaseCli status --workdir $target --output env 2>$null
  $ErrorActionPreference = 'Stop'
  $values = @{}
  foreach ($line in $status) {
    if ($line -match '^([A-Z_]+)=(.*)$') { $values[$Matches[1]] = $Matches[2].Trim('"') }
  }
  if ($values['API_URL'] -ne 'http://127.0.0.1:54321') { throw 'Not the disposable loopback API' }
  $publishable = if ($values['PUBLISHABLE_KEY']) { $values['PUBLISHABLE_KEY'] } else { $values['ANON_KEY'] }
  $service = if ($values['SERVICE_ROLE_KEY']) { $values['SERVICE_ROLE_KEY'] } else { $values['SECRET_KEY'] }
  if (-not $publishable -or -not $service) { throw 'Disposable Auth keys unavailable' }

  Get-Content -LiteralPath (Join-Path $repo 'packages\db\seed.sql') -Raw |
    docker exec -i $dbContainer psql -U postgres -d postgres -v ON_ERROR_STOP=1 *> (Join-Path $target 'seed.log')
  if ($LASTEXITCODE -ne 0) { throw 'Fictional seed failed' }
  $migrationReceipt = & docker exec $dbContainer psql -U postgres -d postgres -Atc `
    "select count(*),bool_or(version='20261124007100'),bool_or(version='20261124015100') from supabase_migrations.schema_migrations"
  if ($LASTEXITCODE -ne 0 -or $migrationReceipt -notmatch '^\d+\|t\|t$') {
    throw 'Required report publisher and quality guard migrations are absent'
  }
  Write-Output "Applied migration count, report 071, quality 151: $migrationReceipt"
  $reportFixture = Join-Path $repo 'apps\web\e2e\fixtures\gate5-qualified-report.sql'
  if ($Scenario -eq 'source-unqualified') {
    $gate3Repo = [IO.Path]::GetFullPath((Join-Path $repo '..\EnvoiLabs-parallel-gate-3'))
    $reportFixture = Join-Path $gate3Repo `
      'apps\web\e2e\fixtures\gate3-qualified-report-private-sentinels.sql'
    if (-not (Test-Path -LiteralPath $reportFixture -PathType Leaf)) {
      throw 'Gate 3 local-only private sentinel fixture is unavailable'
    }
  }
  $ErrorActionPreference = 'Continue'
  & docker cp $reportFixture `
    "$($dbContainer):/tmp/gate5-qualified-report.sql" *> (Join-Path $target 'report.log')
  if ($LASTEXITCODE -eq 0) {
    & docker exec $dbContainer psql -U postgres -d postgres -v ON_ERROR_STOP=1 `
      -f /tmp/gate5-qualified-report.sql *> (Join-Path $target 'report.log')
  }
  $ErrorActionPreference = 'Stop'
  if ($LASTEXITCODE -ne 0) {
    Get-Content -LiteralPath (Join-Path $target 'report.log') -Tail 15
    throw 'Fictional report fixture failed'
  }
  if ($Spec -eq 'gate2-marketplace.spec.ts') {
    $env:ENVOI_GATE5_FICTIONAL_WALKTHROUGH = 'true'
    Get-Content -LiteralPath (Join-Path $repo 'packages\db\scripts\gate2-visa-e2e-fixture.sql') -Raw |
      docker exec -i $dbContainer psql -U postgres -d postgres -v ON_ERROR_STOP=1 *> (Join-Path $target 'marketplace.log')
    if ($LASTEXITCODE -ne 0) { throw 'Fictional marketplace helper failed' }
  }

  $env:SUPABASE_URL = $values['API_URL']
  $env:SUPABASE_PUBLISHABLE_KEY = $publishable
  $env:SUPABASE_SERVICE_ROLE_KEY = $service
  $env:ENVOI_APP_ORIGIN = 'http://127.0.0.1:3100'
  $env:ENVOI_TEST_LOCAL_SUPABASE = '1'
  $env:ENVOI_GATE5_REPORT_FIXTURE = '1'
  $env:NEXT_TELEMETRY_DISABLED = '1'
  if ($Spec -eq 'gate2-marketplace.spec.ts') {
    $env:ENVOI_GATE1_TEST_LAUNCH = '1'
    $env:ENVOI_GATE2_SCREENING_SHEET_ENABLED = 'true'
    $env:ENVOI_GATE2_SCREENING_VOICE_ENABLED = 'true'
    $env:ENVOI_GATE2_EARNINGS_ENABLED = 'true'
    $env:ENVOI_MARKETPLACE_FEASIBILITY_ENABLED = 'true'
    if ($FullWalkthrough) {
      $env:ENVOI_GATE5_FULL_WALKTHROUGH = '1'
      $env:ENVOI_GATE2_REFERRAL_ENABLED = 'true'
      if ($MobileTrace) { $env:ENVOI_GATE5_MOBILE_TRACE = '1' }
      $env:ENVOI_GATE5_MOUNTED_DB_CONTAINER = $dbContainer
      $ErrorActionPreference = 'Continue'
      & docker cp (Join-Path $repo 'apps\web\e2e\fixtures\gate5-same-study-report.sql') `
        "$($dbContainer):/tmp/gate5-same-study-report.sql" *> (Join-Path $target 'same-study.log')
      $ErrorActionPreference = 'Stop'
      if ($LASTEXITCODE -ne 0) { throw 'Same-study fictional report fixture copy failed' }
    }
  }
  if ($Spec -eq 'researcher/gate3-report.spec.ts') {
    $gate3Spec = Join-Path $repo 'apps\web\e2e\researcher\gate3-report.spec.ts'
    if (-not (Test-Path -LiteralPath $gate3Spec)) {
      throw 'Gate 3 temporary local-only spec is absent'
    }
    $env:ENVOI_GATE3_MOUNTED_REPORT_FIXTURE = '1'
    $env:ENVOI_GATE3_MOUNTED_ORIGIN = 'http://127.0.0.1:3100'
    $env:ENVOI_GATE3_MOUNTED_DB_CONTAINER = $dbContainer
    $env:ENVOI_GATE3_MOUNTED_SCENARIO = $Scenario
    if ($Scenario -eq 'source-unqualified') {
      $env:ENVOI_GATE3_MOUNTED_PRIVATE_SENTINELS = '1'
    }
  }
  Push-Location $repo
  try {
    pnpm exec playwright test --project=$Project --retries=0 --workers=1 $Spec
    if ($LASTEXITCODE -ne 0) { throw "Disposable browser test failed: $Spec" }
  } finally { Pop-Location }
} finally {
  $ErrorActionPreference = 'Continue'
  & $supabaseCli stop --workdir $target --no-backup *> $null
  $ErrorActionPreference = 'Stop'
  $leftovers = @(& docker ps -a --filter "name=$projectId" --format '{{.Names}}')
  foreach ($name in $leftovers) {
    if ($name -notmatch "^supabase_[a-z0-9_]+_$([regex]::Escape($projectId))$") {
      throw "Refusing unexpected local container $name"
    }
    if ((& docker inspect --format '{{.State.Running}}' $name) -ne 'false') {
      throw "Disposable container still running: $name"
    }
    & docker rm $name | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Could not remove disposable container $name" }
  }
  if (@(& docker ps -a --filter "name=$projectId" --format '{{.Names}}').Count -ne 0) {
    throw 'Disposable containers remain after cleanup'
  }
  if ((Test-Path -LiteralPath $target) -and
    $target.StartsWith($repo + [IO.Path]::DirectorySeparatorChar) -and
    (Split-Path $target -Leaf) -eq '.gate5-auth') {
    Remove-Item -LiteralPath $target -Recurse -Force
  }
  Write-Output "Disposable Auth directory remains: $(Test-Path -LiteralPath $target)"
}
