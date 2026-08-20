# Downloads a stronger multilingual Whisper pack in sherpa-onnx format and
# installs it under models/asr/. Couple Lab auto-detects any pack that is not
# whisper-tiny and prefers it, so no code or config change is needed.
#
#   powershell -ExecutionPolicy Bypass -File .\scripts\install-better-asr.ps1
#   powershell -ExecutionPolicy Bypass -File .\scripts\install-better-asr.ps1 -Model small
#
# Packs are the official sherpa-onnx exports published by the sherpa-onnx
# maintainer, so they load without any conversion step.

[CmdletBinding()]
param(
  [ValidateSet("turbo", "medium", "small")]
  [string]$Model = "turbo"
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$projectRoot = Split-Path -Parent $PSScriptRoot
$targetDirectory = Join-Path $projectRoot "models\asr\whisper-$Model"
$repository = "csukuangfj/sherpa-onnx-whisper-$Model"
$baseUrl = "https://huggingface.co/$repository/resolve/main"

$approximateSize = switch ($Model) {
  "turbo"  { "about 1.0 GB" }
  "medium" { "about 0.9 GB" }
  "small"  { "about 0.4 GB" }
}

Write-Host ""
Write-Host "Couple Lab - transcription upgrade" -ForegroundColor Cyan
Write-Host "  model   : whisper-$Model (multilingual, int8)"
Write-Host "  source  : https://huggingface.co/$repository"
Write-Host "  size    : $approximateSize"
Write-Host "  install : $targetDirectory"
Write-Host ""

$files = @(
  @{ Name = "$Model-encoder.int8.onnx"; Label = "encoder" },
  @{ Name = "$Model-decoder.int8.onnx"; Label = "decoder" },
  @{ Name = "$Model-tokens.txt";        Label = "tokens"  }
)

New-Item -ItemType Directory -Force -Path $targetDirectory | Out-Null

foreach ($file in $files) {
  $destination = Join-Path $targetDirectory $file.Name
  $partial = "$destination.part"

  if (Test-Path $destination) {
    $existingMb = [math]::Round((Get-Item $destination).Length / 1MB, 1)
    Write-Host ("  [skip] {0} already present ({1} MB)" -f $file.Label, $existingMb) -ForegroundColor DarkGray
    continue
  }

  $url = "$baseUrl/$($file.Name)"
  Write-Host ("  [get ] {0} ..." -f $file.Label) -NoNewline
  try {
    Invoke-WebRequest -Uri $url -OutFile $partial -UseBasicParsing -MaximumRedirection 5
    Move-Item -Force $partial $destination
    $sizeMb = [math]::Round((Get-Item $destination).Length / 1MB, 1)
    Write-Host (" done ({0} MB)" -f $sizeMb) -ForegroundColor Green
  } catch {
    if (Test-Path $partial) { Remove-Item -Force $partial }
    Write-Host " FAILED" -ForegroundColor Red
    Write-Host "         $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "         Download manually from: $url" -ForegroundColor Yellow
    exit 1
  }
}

$sourceNotes = @"
# Packaged sherpa-onnx Whisper model

- Pack: whisper-$Model (multilingual, int8 quantized)
- Source: https://huggingface.co/$repository
- Files: $Model-encoder.int8.onnx, $Model-decoder.int8.onnx, $Model-tokens.txt
- Installed by scripts/install-better-asr.ps1 on $(Get-Date -Format "yyyy-MM-dd")

These are runtime assets. They transcribe locally and nothing is uploaded.
Couple Lab prefers any pack in models/asr/ that is not whisper-tiny.
To roll back, delete this folder and relaunch.
"@
Set-Content -Path (Join-Path $targetDirectory "SOURCE.md") -Value $sourceNotes -Encoding UTF8

Write-Host ""
Write-Host "Installed." -ForegroundColor Green
Write-Host "Next:"
Write-Host "  1. Relaunch Couple Lab from the desktop shortcut."
Write-Host "  2. Re-run the voice calibration (read the two sentences)."
Write-Host "     The new word-accuracy score is measured automatically and"
Write-Host "     compared against the previous model."
Write-Host "  3. If it is slower than you like, try:  -Model small"
Write-Host "  4. To roll back: delete $targetDirectory"
Write-Host ""
