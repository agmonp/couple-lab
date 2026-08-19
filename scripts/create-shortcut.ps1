<#
    Puts a "Couple Lab" shortcut on the desktop, pointing at the launcher in this
    folder and carrying the app icon.

    The desktop path is resolved through Windows rather than assumed to be
    %USERPROFILE%\Desktop, because OneDrive commonly redirects it elsewhere.
#>

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$launcher = Join-Path $root "Open Couple Lab.cmd"
$icon = Join-Path $root "public\couple-lab.ico"

if (-not (Test-Path -LiteralPath $launcher)) {
    Write-Host ""
    Write-Host "Could not find 'Open Couple Lab.cmd' next to this script." -ForegroundColor Red
    Write-Host "Run this from inside the Couple Lab folder."
    Read-Host "Press Enter to close"
    exit 1
}

$desktop = [Environment]::GetFolderPath("Desktop")
if ([string]::IsNullOrWhiteSpace($desktop) -or -not (Test-Path -LiteralPath $desktop)) {
    $desktop = Join-Path $env:USERPROFILE "Desktop"
}

$linkPath = Join-Path $desktop "Couple Lab.lnk"

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($linkPath)
$shortcut.TargetPath = $launcher
$shortcut.WorkingDirectory = $root
$shortcut.Description = "Couple Lab - a private place to practice connection"
# 7 = start minimised, so the launcher console does not sit in the way.
$shortcut.WindowStyle = 7
if (Test-Path -LiteralPath $icon) {
    $shortcut.IconLocation = "$icon,0"
}
$shortcut.Save()

Write-Host ""
Write-Host "Done. 'Couple Lab' is on your desktop." -ForegroundColor Green
Write-Host "Folder used: $root"
Write-Host "Shortcut:    $linkPath"
Write-Host ""
Write-Host "Double-click it to open the app."
Write-Host ""
Read-Host "Press Enter to close"
