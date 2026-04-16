param(
  [ValidateSet("start", "stop", "status")]
  [string]$Action = "start"
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$localRoot = Join-Path $repoRoot ".local"
$dataDir = Join-Path $localRoot "postgres-data"
$logsDir = Join-Path $localRoot "logs"
$logFile = Join-Path $logsDir "postgres.log"
$dbName = "logistics_db"
$port = "5433"
$dbUser = "postgres"

function Get-PostgresBin {
  $candidates = @()

  $pgCtlCommand = Get-Command "pg_ctl.exe" -ErrorAction SilentlyContinue
  if ($pgCtlCommand) {
    $candidates += Split-Path $pgCtlCommand.Source -Parent
  }

  $candidates += @(
    "D:\postgres\bin",
    "C:\Program Files\PostgreSQL\16\bin",
    "C:\Program Files\PostgreSQL\15\bin"
  )

  foreach ($candidate in $candidates | Select-Object -Unique) {
    if ($candidate -and (Test-Path (Join-Path $candidate "pg_ctl.exe"))) {
      return $candidate
    }
  }

  throw "Не найден PostgreSQL bin. Нужен pg_ctl.exe / initdb.exe в PATH или в D:\postgres\bin."
}

function Invoke-PgCtlStatus {
  param([string]$pgCtlPath)

  & $pgCtlPath -D $dataDir status *> $null
  return $LASTEXITCODE -eq 0
}

function Ensure-Database {
  param(
    [string]$psqlPath,
    [string]$createdbPath
  )

  $exists = & $psqlPath -h localhost -p $port -U $dbUser -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '$dbName';"
  if ($LASTEXITCODE -ne 0) {
    throw "Не удалось проверить наличие базы данных $dbName."
  }

  if ($exists.Trim() -ne "1") {
    & $createdbPath -h localhost -p $port -U $dbUser $dbName
    if ($LASTEXITCODE -ne 0) {
      throw "Не удалось создать базу данных $dbName."
    }
  }
}

$pgBin = Get-PostgresBin
$pgCtl = Join-Path $pgBin "pg_ctl.exe"
$initdb = Join-Path $pgBin "initdb.exe"
$createdb = Join-Path $pgBin "createdb.exe"
$psql = Join-Path $pgBin "psql.exe"
$pgIsReady = Join-Path $pgBin "pg_isready.exe"

New-Item -ItemType Directory -Path $localRoot -Force | Out-Null
New-Item -ItemType Directory -Path $logsDir -Force | Out-Null

switch ($Action) {
  "start" {
    if (!(Test-Path (Join-Path $dataDir "PG_VERSION"))) {
      New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
      & $initdb -D $dataDir -U $dbUser -A trust -E UTF8
      if ($LASTEXITCODE -ne 0) {
        throw "Не удалось инициализировать локальный PostgreSQL кластер."
      }
    }

    if (-not (Invoke-PgCtlStatus -pgCtlPath $pgCtl)) {
      & $pgCtl -D $dataDir -l $logFile -o "-p $port" start
      if ($LASTEXITCODE -ne 0) {
        throw "Не удалось запустить локальный PostgreSQL."
      }
      Start-Sleep -Seconds 2
    }

    & $pgIsReady -h localhost -p $port | Out-Null
    if ($LASTEXITCODE -ne 0) {
      throw "PostgreSQL не принимает подключения на localhost:$port."
    }

    Ensure-Database -psqlPath $psql -createdbPath $createdb
    Write-Host "Local PostgreSQL ready on localhost:$port (db: $dbName)"
  }

  "stop" {
    if (Test-Path (Join-Path $dataDir "PG_VERSION")) {
      & $pgCtl -D $dataDir stop -m fast
      if ($LASTEXITCODE -eq 0) {
        Write-Host "Local PostgreSQL stopped."
      }
    }
  }

  "status" {
    if (Invoke-PgCtlStatus -pgCtlPath $pgCtl) {
      Write-Host "Local PostgreSQL is running."
    } else {
      Write-Host "Local PostgreSQL is stopped."
      exit 1
    }
  }
}
