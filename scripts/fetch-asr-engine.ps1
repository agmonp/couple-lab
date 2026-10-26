# Fetches the whisper.cpp engine (Vulkan + CPU) that the packaged app bundles,
# from the release built by .github/workflows/build-asr-engine.yml, verifies
# its SHA-256 and unpacks only the files the app runs into vendor\whisper-engine.
#
#   powershell -ExecutionPolicy Bypass -File .\scripts\fetch-asr-engine.ps1
#
# The Hebrew model itself is not bundled: the app downloads it on request.

[CmdletBinding()]
param(
  [string]$Release = "asr-engine-v1",
  [string]$Sha256 = "ae0afe66b5650dda131ef4b961ca7fa114a46acbc396a62b85dd250c23182102"
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$target = Join-Path $projectRoot "vendor\whisper-engine"
$zip = Join-Path ([System.IO.Path]::GetTempPath()) "couple-lab-whisper-engine.zip"
$url = "https://github.com/agmonp/couple-lab/releases/download/$Release/whisper-engine-win-x64.zip"

Write-Host "Downloading $url"
Invoke-WebRequest $url -OutFile $zip -UseBasicParsing
$actual = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
if ($actual -ne $Sha256) { throw "Checksum mismatch: expected $Sha256, got $actual" }

$unpacked = Join-Path ([System.IO.Path]::GetTempPath()) "couple-lab-whisper-engine"
if (Test-Path $unpacked) { Remove-Item -Recurse -Force $unpacked }
Expand-Archive $zip -DestinationPath $unpacked

if (Test-Path $target) { Remove-Item -Recurse -Force $target }
New-Item -ItemType Directory -Force $target | Out-Null
$keep = @("whisper-server.exe", "whisper.dll", "ggml.dll", "ggml-base.dll", "ggml-vulkan.dll", "LICENSE-whisper.cpp.txt", "SOURCE.md")
Get-ChildItem $unpacked | Where-Object { $keep -contains $_.Name -or $_.Name -like "ggml-cpu-*.dll" } | Copy-Item -Destination $target
Remove-Item -Recurse -Force $unpacked, $zip

Get-ChildItem $target | Select-Object Name, Length | Format-Table -AutoSize
Write-Host "Engine ready in $target" -ForegroundColor Green
