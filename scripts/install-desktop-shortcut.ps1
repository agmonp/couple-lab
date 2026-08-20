$ErrorActionPreference = "Stop"

$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$electronPath = Join-Path $projectRoot "node_modules\electron\dist\electron.exe"
$builtAppPath = Join-Path $projectRoot "dist\index.html"
$iconPath = Join-Path $projectRoot "public\app-icon.ico"
$desktopPath = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktopPath "Couple Lab.lnk"

if (-not (Test-Path -LiteralPath $electronPath -PathType Leaf)) {
  throw "Electron was not found. Run npm install before creating the shortcut."
}

if (-not (Test-Path -LiteralPath $builtAppPath -PathType Leaf)) {
  throw "The local Couple Lab build was not found. Run npm run build before creating the shortcut."
}

if (-not (Test-Path -LiteralPath $iconPath -PathType Leaf)) {
  throw "Couple Lab icon was not found: $iconPath"
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $electronPath
$shortcut.Arguments = '"' + $projectRoot + '"'
$shortcut.WorkingDirectory = $projectRoot
$shortcut.IconLocation = "$iconPath,0"
$shortcut.Description = "Open the local Couple Lab Windows app (not the website)"
$shortcut.Save()

Write-Output "Desktop shortcut created: $shortcutPath"
