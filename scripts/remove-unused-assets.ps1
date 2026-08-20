# Removes media assets that are shipped in every build but referenced nowhere
# in the application code. Vite copies all of public/ into dist/, and
# electron-builder packages dist/**/*, so these files add ~15 MB to every
# portable build for no runtime purpose.
#
#   powershell -ExecutionPolicy Bypass -File .\scripts\remove-unused-assets.ps1
#   powershell -ExecutionPolicy Bypass -File .\scripts\remove-unused-assets.ps1 -WhatIf
#
# Files go to the Recycle Bin, not a permanent delete, so this is reversible.
# The graduation-animation source project under
# adam-porat-graduation-animation/ is NOT touched - only the rendered copies
# that sit in public/ and end up inside the shipped app.

[CmdletBinding(SupportsShouldProcess = $true)]
param()

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$publicDirectory = Join-Path $projectRoot "public"

$targets = @(
  "adam-porat-grade-6-graduation-animation.mp4",
  "adam-porat-grade-6-graduation-animation.webp",
  "adam-porat-grade-6-graduation-manga.png"
)

# Guard: never remove a file that the source actually references.
$sourceDirectories = @("src", "electron", "sites-app") |
  ForEach-Object { Join-Path $projectRoot $_ } |
  Where-Object { Test-Path $_ }
$searchRoots = @($sourceDirectories) + @(Join-Path $projectRoot "index.html")

$shell = New-Object -ComObject Shell.Application
$removed = 0
$freedBytes = 0

Write-Host ""
Write-Host "Couple Lab - unused asset cleanup" -ForegroundColor Cyan
Write-Host ""

foreach ($name in $targets) {
  $path = Join-Path $publicDirectory $name
  if (-not (Test-Path $path)) {
    Write-Host ("  [skip] {0} - not present" -f $name) -ForegroundColor DarkGray
    continue
  }

  $stem = [System.IO.Path]::GetFileNameWithoutExtension($name)
  $references = Get-ChildItem -Path $searchRoots -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Extension -in ".ts", ".tsx", ".js", ".jsx", ".cjs", ".mjs", ".css", ".html", ".json" } |
    Select-String -Pattern ([regex]::Escape($stem)) -SimpleMatch -List -ErrorAction SilentlyContinue

  if ($references) {
    Write-Host ("  [keep] {0} - still referenced in {1}" -f $name, $references[0].Path) -ForegroundColor Yellow
    continue
  }

  $sizeMb = [math]::Round((Get-Item $path).Length / 1MB, 1)
  if ($PSCmdlet.ShouldProcess($path, "Move to Recycle Bin")) {
    $freedBytes += (Get-Item $path).Length
    $folder = $shell.Namespace((Split-Path $path))
    $item = $folder.ParseName((Split-Path $path -Leaf))
    # 0x00100000 = move to Recycle Bin without a confirmation dialog.
    $item.InvokeVerb("delete")
    Start-Sleep -Milliseconds 200
    if (Test-Path $path) {
      Remove-Item -Force $path
    }
    $removed++
    Write-Host ("  [del ] {0} ({1} MB) -> Recycle Bin" -f $name, $sizeMb) -ForegroundColor Green
  } else {
    Write-Host ("  [dry ] {0} ({1} MB) would be removed" -f $name, $sizeMb) -ForegroundColor DarkGray
  }
}

Write-Host ""
if ($removed -gt 0) {
  Write-Host ("Removed {0} file(s), {1} MB freed from every future build." -f $removed, [math]::Round($freedBytes / 1MB, 1)) -ForegroundColor Green
  Write-Host "Run 'npm run build' to regenerate dist/ without them."
} else {
  Write-Host "Nothing removed."
}
Write-Host ""
