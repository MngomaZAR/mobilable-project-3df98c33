<#
.SYNOPSIS
Run the financial protocol in an ephemeral, loopback-only PostgreSQL cluster.
.DESCRIPTION
Uses existing portable PostgreSQL binaries. Does not read repository env files,
install software, contact payment providers, or use any existing database cluster.
Only the generated fixture directory and its exact PostgreSQL process are cleaned.
.EXAMPLE
./scripts/test-financial-protocol.ps1 -PostgresBin C:/tools/pgsql/bin -PythonExecutable C:/tools/qa/Scripts/python.exe
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$PostgresBin,
    [string]$PythonExecutable = 'python'
)

$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$bin = (Resolve-Path -LiteralPath $PostgresBin).ProviderPath
$python = (Get-Command $PythonExecutable -ErrorAction Stop).Source
foreach ($tool in @('initdb.exe', 'pg_ctl.exe', 'postgres.exe', 'createdb.exe', 'psql.exe')) {
    if (-not (Test-Path -LiteralPath (Join-Path $bin $tool) -PathType Leaf)) {
        throw "PostgreSQL tool missing: $tool"
    }
}
$base = (Resolve-Path -LiteralPath ([IO.Path]::GetTempPath())).ProviderPath.TrimEnd('\')
$id = [Guid]::NewGuid().ToString('N')
$fixture = [IO.Path]::GetFullPath((Join-Path $base "papzii-financial-protocol-$id"))
$data = Join-Path $fixture 'data'
$database = "financial_qa_$id"
$role = 'financial_fixture'
$environment = @{}
foreach ($name in @('DATABASE_URL', 'FINANCIAL_PROTOCOL_ALLOW_QA', 'PYTHONPATH')) {
    $environment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}
$location = Get-Location
$fixtureCreated = $false
$ownedPostgresId = $null

function Assert-OwnedFixture {
    $resolved = [IO.Path]::GetFullPath($fixture)
    if (-not $resolved.StartsWith($base + '\', [StringComparison]::OrdinalIgnoreCase) -or
        [IO.Path]::GetFileName($resolved) -ne "papzii-financial-protocol-$id") {
        throw 'Refusing an unexpected fixture path.'
    }
    if ((Test-Path -LiteralPath $fixture) -and
        ((Get-Item -LiteralPath $fixture).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw 'Refusing a reparse-point fixture directory.'
    }
}

function Invoke-FixtureTool {
    param([string]$Tool, [string[]]$Arguments, [string]$Label)
    Assert-OwnedFixture
    $quoted = ($Arguments | ForEach-Object { '"' + $_.Replace('"', '\"') + '"' }) -join ' '
    $stdout = Join-Path $fixture "$Label.stdout.log"
    $stderr = Join-Path $fixture "$Label.stderr.log"
    $process = Start-Process -FilePath (Join-Path $bin $Tool) -ArgumentList $quoted -WindowStyle Hidden -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
    # Wait only for pg_ctl, not its intentionally detached PostgreSQL child.
    $process.WaitForExit()
    if ($process.ExitCode -ne 0) {
        Get-Content -LiteralPath $stdout, $stderr
        throw "$Tool failed with exit code $($process.ExitCode)."
    }
}

function Get-OwnedPostgresId {
    $pidFile = Join-Path $data 'postmaster.pid'
    if (-not (Test-Path -LiteralPath $pidFile -PathType Leaf)) { return $null }
    $lines = Get-Content -LiteralPath $pidFile
    $serverId = 0
    if ($lines.Count -lt 2 -or -not [int]::TryParse($lines[0], [ref]$serverId) -or
        [IO.Path]::GetFullPath($lines[1]) -ne [IO.Path]::GetFullPath($data)) {
        throw 'Refusing an unexpected PostgreSQL PID file.'
    }
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $serverId"
    if ($null -eq $process) { return $null }
    if ($process.ExecutablePath -ne (Join-Path $bin 'postgres.exe') -or
        -not $process.CommandLine.Replace('\', '/').Contains($data.Replace('\', '/'))) {
        throw 'Refusing to stop a PostgreSQL process outside this fixture.'
    }
    return $serverId
}

try {
    Assert-OwnedFixture
    if (Test-Path -LiteralPath $fixture) { throw 'Fixture directory already exists.' }
    New-Item -ItemType Directory -Path $fixture | Out-Null
    $fixtureCreated = $true
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
    try {
        $listener.Start()
        $port = $listener.LocalEndpoint.Port
    } finally {
        $listener.Stop()
    }
    Invoke-FixtureTool 'initdb.exe' @('-D', $data, '-U', $role, '-A', 'trust', '--no-locale', '--encoding=UTF8') 'initdb'
    Invoke-FixtureTool 'pg_ctl.exe' @('-D', $data, '-l', (Join-Path $fixture 'postgres.log'), '-o', "-h 127.0.0.1 -p $port -c max_connections=30", '-w', '-t', '30', 'start') 'start'
    $ownedPostgresId = Get-OwnedPostgresId
    if ($null -eq $ownedPostgresId) { throw 'Fixture PostgreSQL did not start.' }
    $connection = @('-h', '127.0.0.1', '-p', "$port", '-U', $role, '--no-password')
    Invoke-FixtureTool 'createdb.exe' ($connection + @($database)) 'createdb'
    Invoke-FixtureTool 'psql.exe' ($connection + @('-d', $database, '-v', 'ON_ERROR_STOP=1', '-c', 'CREATE EXTENSION pgcrypto WITH SCHEMA public')) 'pgcrypto'
    $env:DATABASE_URL = "postgresql://${role}@127.0.0.1:${port}/${database}"
    $env:FINANCIAL_PROTOCOL_ALLOW_QA = 'true'
    $env:PYTHONPATH = Join-Path $repo 'backend'
    Set-Location -LiteralPath (Join-Path $repo 'backend/api')
    & $python -m tests.financial_protocol
    if ($LASTEXITCODE -ne 0) { throw "Financial protocol failed with exit code $LASTEXITCODE." }
} finally {
    Set-Location -LiteralPath $location.Path
    foreach ($name in $environment.Keys) {
        [Environment]::SetEnvironmentVariable($name, $environment[$name], 'Process')
    }
    if ($fixtureCreated) {
        Assert-OwnedFixture
        $serverId = Get-OwnedPostgresId
        if ($null -ne $serverId) {
            if ($null -ne $ownedPostgresId -and $serverId -ne $ownedPostgresId) {
                throw 'Fixture PostgreSQL process identity changed; refusing cleanup.'
            }
            Invoke-FixtureTool 'pg_ctl.exe' @('-D', $data, '-m', 'fast', '-w', '-t', '30', 'stop') 'stop'
            if ($null -ne (Get-OwnedPostgresId)) { throw 'Fixture PostgreSQL is still running; preserving its data.' }
        }
        Assert-OwnedFixture
        Remove-Item -LiteralPath $fixture -Recurse -Force
        if (Test-Path -LiteralPath $fixture) { throw 'Fixture data cleanup failed.' }
        Write-Output 'Fixture PostgreSQL stopped; owned data directory removed.'
    }
}
