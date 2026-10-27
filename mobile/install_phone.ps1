# For developers: install the Couple Lab debug build on every phone connected over adb (USB or Wi-Fi).
#   .\install_phone.ps1                  -> android\app\build\outputs\apk\debug\app-debug.apk
#   .\install_phone.ps1 -Apk path\to.apk
# On the phone, once: Developer options > USB debugging. Xiaomi (HyperOS/MIUI): also "Install via USB".
# OPPO / realme (ColorOS): "Install via USB" if present, or "Disable permission monitoring".
param([string]$Apk = "")
$ErrorActionPreference = "Continue"
$pkg = "com.couplelab.app"
$adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
if (-not (Test-Path $adb)) { $adb = "adb" }
if (-not $Apk) { $Apk = "$PSScriptRoot\android\app\build\outputs\apk\debug\app-debug.apk" }
if (-not (Test-Path $Apk)) { Write-Host "No APK at $Apk. Build it: npm run sync, then android\gradlew.bat assembleDebug"; exit 1 }

$serials = & $adb devices | Select-String "`tdevice$" | ForEach-Object { ($_ -split "`t")[0] }
if (-not $serials) { Write-Host "No phone found. Connect by USB and allow USB debugging on the phone."; exit 1 }
foreach ($s in $serials) {
    $model = (& $adb -s $s shell getprop ro.product.model).Trim()
    $out = (& $adb -s $s install -r $Apk 2>&1 | Out-String)
    if ($out -notmatch "Success") {
        Write-Host "$model ($s): INSTALL FAILED: $out"
        if ($out -match "USER_RESTRICTED") { Write-Host "  Xiaomi: 'Install via USB'. OPPO/realme: 'Install via USB' / 'Disable permission monitoring'." }
        continue
    }
    & $adb -s $s shell am start -n "$pkg/.MainActivity" | Out-Null
    Write-Host "$model ($s): installed and opened."
}
