$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false

$repoRoot = Split-Path -Parent $PSScriptRoot
$requirements = Join-Path $repoRoot "ai-service\requirements.txt"
$venvDir = Join-Path $repoRoot ".local\ai-venv"
$venvPython = Join-Path $venvDir "Scripts\python.exe"
$env:PYTHONUTF8 = "1"
$env:PYTHONIOENCODING = "utf-8"

if (!(Test-Path $venvPython)) {
  & py -3 -m venv $venvDir
  if ($LASTEXITCODE -ne 0) {
    throw "Не удалось создать virtualenv для ai-service."
  }
}

& $venvPython -m pip install --upgrade pip
if ($LASTEXITCODE -ne 0) {
  throw "Не удалось обновить pip в virtualenv ai-service."
}

& $venvPython -m pip install -r $requirements
if ($LASTEXITCODE -ne 0) {
  throw "Не удалось установить Python-зависимости для ai-service."
}

Push-Location (Join-Path $repoRoot "ai-service")
try {
  & $venvPython -m uvicorn main:app --reload --host 0.0.0.0 --port 8000
}
finally {
  Pop-Location
}
