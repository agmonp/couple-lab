# Sets up the local Hebrew transcription engine (faster-whisper + ivrit-ai whisper-large-v3-turbo).
# Creates .venv-asr in the project and downloads the model once (~1.6 GB) into the Hugging Face cache.
# Couple Lab uses it automatically when .venv-asr exists; everything runs on this computer.
#
#   powershell -ExecutionPolicy Bypass -File .\scripts\install-hebrew-asr.ps1
#
# Needs Python 3.10-3.12. An NVIDIA GPU is used when present, otherwise the CPU (slower).
# To roll back: delete .venv-asr and relaunch (Couple Lab returns to sherpa-onnx).

[CmdletBinding()]
param(
  [string]$Python = "",
  [string]$Model = "ivrit-ai/whisper-large-v3-turbo-ct2"
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$venv = Join-Path $projectRoot ".venv-asr"

if (-not $Python) {
  foreach ($version in "3.11", "3.12", "3.10") {
    $candidate = (& py "-$version" -c "import sys; print(sys.executable)" 2>$null)
    if ($LASTEXITCODE -eq 0 -and $candidate) { $Python = $candidate.Trim(); break }
  }
}
if (-not $Python) { throw "Python 3.10-3.12 not found. Install it, or pass -Python <path to python.exe>." }

Write-Host "Couple Lab - Hebrew transcription engine" -ForegroundColor Cyan
Write-Host "  python : $Python"
Write-Host "  venv   : $venv"
Write-Host "  model  : $Model"

if (-not (Test-Path (Join-Path $venv "Scripts\python.exe"))) { & $Python -m venv $venv }
$venvPython = Join-Path $venv "Scripts\python.exe"
& $venvPython -m pip install -q --upgrade pip
& $venvPython -m pip install -q "faster-whisper==1.2.1" "nvidia-cublas-cu12" "nvidia-cudnn-cu12==9.*"
if ($LASTEXITCODE -ne 0) { throw "pip install failed" }

Write-Host "  downloading the model (once)..."
& $venvPython -c "from huggingface_hub import snapshot_download; print(snapshot_download('$Model'))"
if ($LASTEXITCODE -ne 0) { throw "model download failed" }

Write-Host "  checking the engine..."
$status = '{"id":1,"type":"status"}' | & $venvPython -I (Join-Path $projectRoot "electron\whisper-engine.py") 2>$null
Write-Host "  $status"
if ($status -notmatch '"ok": true') { throw "engine check failed" }
Write-Host "Installed. Relaunch Couple Lab; Settings shows the new model id." -ForegroundColor Green
