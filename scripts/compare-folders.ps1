<#
    Compares two candidate Couple Lab folders and reports which one is the live
    working copy.

    It never deletes anything. It can make a ZIP backup of the folder that looks
    unused, so the copy can be removed by hand afterwards with nothing at risk.
#>

param(
    [string]$A = "C:\Users\User\Documents\Love app tamar agmon",
    [string]$B = "C:\Users\User\couple-lab"
)

$ErrorActionPreference = "Stop"

function Get-FolderReport {
    param([string]$Path)

    $report = [ordered]@{
        Path         = $Path
        Exists       = Test-Path -LiteralPath $Path
        IsCoupleLab  = $false
        FileCount    = 0
        SizeMB       = 0
        NewestFile   = $null
        NewestWhen   = $null
        HasGit       = $false
        Branch       = ""
        LastCommit   = ""
        HasModules   = $false
        HasLocalEdit = $false
    }

    if (-not $report.Exists) { return [pscustomobject]$report }

    # src/App.tsx is the app's main source file; its presence is what makes a
    # folder a Couple Lab copy rather than an unrelated directory.
    $report.IsCoupleLab = Test-Path -LiteralPath (Join-Path $Path "src\App.tsx")
    $report.HasModules = Test-Path -LiteralPath (Join-Path $Path "node_modules")
    $report.HasGit = Test-Path -LiteralPath (Join-Path $Path ".git")

    # node_modules is machine-generated and would swamp both the counts and the
    # "most recently touched" signal, so it is left out.
    $files = Get-ChildItem -LiteralPath $Path -Recurse -File -Force -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -notmatch "\\node_modules\\|\\\.git\\|\\dist\\" }

    $report.FileCount = @($files).Count
    if ($report.FileCount -gt 0) {
        $report.SizeMB = [math]::Round((($files | Measure-Object -Property Length -Sum).Sum / 1MB), 2)
        $newest = $files | Sort-Object LastWriteTime -Descending | Select-Object -First 1
        $report.NewestFile = $newest.FullName.Substring($Path.Length).TrimStart("\")
        $report.NewestWhen = $newest.LastWriteTime
    }

    if ($report.HasGit -and (Get-Command git -ErrorAction SilentlyContinue)) {
        Push-Location $Path
        try {
            $report.Branch = (git rev-parse --abbrev-ref HEAD 2>$null)
            $report.LastCommit = (git log -1 --format="%h %ad %s" --date=short 2>$null)
            $status = (git status --porcelain 2>$null)
            $report.HasLocalEdit = -not [string]::IsNullOrWhiteSpace($status)
        } catch {
            # A folder can contain .git without git being usable; the other
            # signals are enough to judge it.
        } finally {
            Pop-Location
        }
    }

    return [pscustomobject]$report
}

function Show-Report {
    param($Report, [string]$Label)

    Write-Host ""
    Write-Host "$Label" -ForegroundColor Cyan
    Write-Host "  $($Report.Path)"

    if (-not $Report.Exists) {
        Write-Host "  DOES NOT EXIST on this computer." -ForegroundColor DarkGray
        return
    }
    if (-not $Report.IsCoupleLab) {
        Write-Host "  Exists, but does not look like Couple Lab (no src\App.tsx)." -ForegroundColor Yellow
    }

    Write-Host "  Files (excluding node_modules): $($Report.FileCount)   Size: $($Report.SizeMB) MB"
    if ($Report.NewestWhen) {
        Write-Host "  Last edited: $($Report.NewestWhen)  ->  $($Report.NewestFile)"
    }
    Write-Host "  Dependencies installed (node_modules): $(if ($Report.HasModules) { 'yes' } else { 'no' })"

    if ($Report.HasGit) {
        Write-Host "  Git branch: $($Report.Branch)"
        if ($Report.LastCommit) { Write-Host "  Last commit: $($Report.LastCommit)" }
        if ($Report.HasLocalEdit) {
            Write-Host "  Has uncommitted changes - this copy holds work that is nowhere else." -ForegroundColor Yellow
        }
    } else {
        Write-Host "  Not a git folder."
    }
}

Write-Host ""
Write-Host "=====================================================" -ForegroundColor White
Write-Host " Couple Lab - which folder are you actually using?" -ForegroundColor White
Write-Host "=====================================================" -ForegroundColor White

$reportA = Get-FolderReport -Path $A
$reportB = Get-FolderReport -Path $B

Show-Report -Report $reportA -Label "FOLDER 1"
Show-Report -Report $reportB -Label "FOLDER 2"

Write-Host ""
Write-Host "-----------------------------------------------------" -ForegroundColor White
Write-Host " What this means" -ForegroundColor White
Write-Host "-----------------------------------------------------" -ForegroundColor White
Write-Host ""
Write-Host "Your sessions, scores and transcripts are NOT stored in either folder."
Write-Host "They live in your browser, under the address http://127.0.0.1:5173."
Write-Host "Both folders open that same address, so your saved work survives"
Write-Host "whichever folder you keep. Use Export in the app first if you want a copy."
Write-Host ""

$live = $null
$spare = $null

if ($reportA.Exists -and -not $reportB.Exists) {
    Write-Host "VERDICT: only Folder 1 exists. Nothing to delete." -ForegroundColor Green
} elseif ($reportB.Exists -and -not $reportA.Exists) {
    Write-Host "VERDICT: only Folder 2 exists. Nothing to delete." -ForegroundColor Green
} elseif (-not $reportA.Exists -and -not $reportB.Exists) {
    Write-Host "VERDICT: neither folder exists. Check the paths and run again." -ForegroundColor Yellow
} else {
    # Both exist. The newer, git-tracked, dependency-installed one is the live copy.
    $scoreA = 0
    $scoreB = 0
    if ($reportA.IsCoupleLab) { $scoreA += 3 }
    if ($reportB.IsCoupleLab) { $scoreB += 3 }
    if ($reportA.HasGit) { $scoreA += 2 }
    if ($reportB.HasGit) { $scoreB += 2 }
    if ($reportA.HasModules) { $scoreA += 1 }
    if ($reportB.HasModules) { $scoreB += 1 }
    if ($reportA.NewestWhen -and $reportB.NewestWhen) {
        if ($reportA.NewestWhen -gt $reportB.NewestWhen) { $scoreA += 2 } else { $scoreB += 2 }
    }

    if ($scoreA -gt $scoreB) {
        $live = $reportA; $spare = $reportB
    } elseif ($scoreB -gt $scoreA) {
        $live = $reportB; $spare = $reportA
    }

    if ($null -eq $live) {
        Write-Host "VERDICT: the two folders look equally current." -ForegroundColor Yellow
        Write-Host "Do not delete either one yet. Open each with 'Open Couple Lab.cmd'"
        Write-Host "and keep the one that behaves the way you expect."
    } else {
        Write-Host "LIKELY IN USE:  $($live.Path)" -ForegroundColor Green
        Write-Host "LIKELY SPARE:   $($spare.Path)" -ForegroundColor Yellow
        if ($spare.HasLocalEdit) {
            Write-Host ""
            Write-Host "CAUTION: the spare copy has uncommitted changes in it." -ForegroundColor Red
            Write-Host "Back it up and look through it before deleting anything."
        }
    }
}

Write-Host ""

if ($null -ne $spare) {
    Write-Host "This script does not delete anything."
    $answer = Read-Host "Make a ZIP backup of the spare folder on your desktop first? (y/n)"
    if ($answer -match "^(y|yes)$") {
        $desktop = [Environment]::GetFolderPath("Desktop")
        if ([string]::IsNullOrWhiteSpace($desktop)) { $desktop = Join-Path $env:USERPROFILE "Desktop" }
        $stamp = Get-Date -Format "yyyy-MM-dd-HHmm"
        $zip = Join-Path $desktop "couple-lab-backup-$stamp.zip"

        Write-Host "Zipping (this can take a minute)..."
        # node_modules is reinstallable and very large, so it is left out of the backup.
        $staging = Join-Path $env:TEMP "couple-lab-backup-$stamp"
        New-Item -ItemType Directory -Path $staging -Force | Out-Null
        Get-ChildItem -LiteralPath $spare.Path -Force |
            Where-Object { $_.Name -ne "node_modules" } |
            Copy-Item -Destination $staging -Recurse -Force -ErrorAction SilentlyContinue
        Compress-Archive -Path (Join-Path $staging "*") -DestinationPath $zip -Force
        Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue

        Write-Host ""
        Write-Host "Backup saved: $zip" -ForegroundColor Green
        Write-Host "Once you have checked it, you can delete:" -ForegroundColor Green
        Write-Host "  $($spare.Path)"
    } else {
        Write-Host "No backup made. Nothing was changed."
    }
}

Write-Host ""
Read-Host "Press Enter to close"
