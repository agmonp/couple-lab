<#
    Two-way sync between this folder and GitHub.

    Order matters and is deliberate: local work is committed FIRST, then the
    remote is merged in, then everything is pushed. That sequence means local-only
    work (for example a version that exists on this computer but not on GitHub) is
    saved and uploaded — never overwritten by the download.

    If local and remote changed the same lines, the script stops and leaves the
    folder untouched rather than guessing. Nothing is ever force-pushed.
#>

$ErrorActionPreference = "Stop"

# Work in the repository this script lives in.
$root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root

function Fail($message) {
    Write-Host ""
    Write-Host $message -ForegroundColor Red
    Write-Host ""
    Read-Host "Press Enter to close"
    exit 1
}

Write-Host ""
Write-Host "=====================================================" -ForegroundColor White
Write-Host " Couple Lab - sync this folder with GitHub" -ForegroundColor White
Write-Host "=====================================================" -ForegroundColor White
Write-Host "Folder: $root"
Write-Host ""

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Fail "git is not installed. Install Git for Windows from https://git-scm.com, then run this again."
}
if (-not (Test-Path -LiteralPath (Join-Path $root ".git"))) {
    Fail "This folder is not connected to GitHub (no .git folder). Ask for help linking it before syncing."
}

$branch = (git rev-parse --abbrev-ref HEAD).Trim()
Write-Host "Branch: $branch"
Write-Host ""

# 1. Save local work first, so the download can never erase it.
$dirty = git status --porcelain
if (-not [string]::IsNullOrWhiteSpace($dirty)) {
    Write-Host "Saving your local changes..." -ForegroundColor Cyan
    git add -A
    $stamp = Get-Date -Format "yyyy-MM-dd HH:mm"
    git commit -m "Local changes from this computer ($stamp)" | Out-Null
    Write-Host "Saved." -ForegroundColor Green
} else {
    Write-Host "No local changes to save." -ForegroundColor Green
}
Write-Host ""

# 2. Bring in what is on GitHub. --rebase keeps history tidy; it stops on conflict.
Write-Host "Downloading the latest from GitHub..." -ForegroundColor Cyan
git fetch origin 2>&1 | Out-Null

$remoteExists = $true
git rev-parse --verify --quiet "origin/$branch" > $null 2>&1
if ($LASTEXITCODE -ne 0) { $remoteExists = $false }

if ($remoteExists) {
    git rebase "origin/$branch"
    if ($LASTEXITCODE -ne 0) {
        git rebase --abort 2>&1 | Out-Null
        Fail @"
Your computer and GitHub both changed the same thing, so the sync stopped and
changed nothing here. This is safe - no work was lost.

Get help merging the two versions by hand. Your local work is committed and
still here; nothing was thrown away.
"@
    }
    Write-Host "Merged GitHub's changes." -ForegroundColor Green
} else {
    Write-Host "This branch is not on GitHub yet - it will be created on upload." -ForegroundColor Yellow
}
Write-Host ""

# 3. Upload. A normal push (never forced), so a rejection means fetch again.
Write-Host "Uploading to GitHub..." -ForegroundColor Cyan
git push -u origin $branch
if ($LASTEXITCODE -ne 0) {
    Fail @"
Upload was rejected, usually because GitHub changed again while syncing.
Just run this file once more. Your work is committed and safe.
"@
}

Write-Host ""
Write-Host "Done. This folder and GitHub now match." -ForegroundColor Green
Write-Host "Last commit: $((git log -1 --format='%h %s').Trim())"
Write-Host ""
Read-Host "Press Enter to close"
