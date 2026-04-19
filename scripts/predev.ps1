param(
  [ValidateSet("start")]
  [string]$Action = "start"
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot

& (Join-Path $PSScriptRoot "local-postgres.ps1") start
