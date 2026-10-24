# Build Luminor.exe and a distributable zip.
#   powershell -ExecutionPolicy Bypass -File build.ps1
# Requires the "luminor-build" conda environment (see README.md, "Building from source").
param([string]$Python = "$env:USERPROFILE\anaconda3\envs\luminor-build\python.exe")

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $here
$version = "1.1"

if (-not (Test-Path $Python)) { throw "Python not found: $Python (create the luminor-build environment first)" }

# Conda keeps DLLs used by Python itself (ffi, lzma, bz2, expat, ssl, tcl/tk...) in
# Library\bin. Put them on PATH, as "conda activate" would, so PyInstaller finds and
# bundles them; otherwise the exe fails with "DLL load failed while importing _ctypes".
$envDir = Split-Path -Parent $Python
$env:PATH = "$envDir;$envDir\Library\mingw-w64\bin;$envDir\Library\usr\bin;$envDir\Library\bin;$envDir\Scripts;$env:PATH"

Write-Host "1/4  Icon"
& $Python make_icon.py

Write-Host "2/4  PyInstaller"
& $Python -m PyInstaller --noconfirm --clean --distpath dist --workpath build luminor.spec

Write-Host "3/4  Helper shortcut"
Set-Content -Path "dist\Luminor\Choose data folder.cmd" -Encoding ASCII -Value '@start "" "%~dp0Luminor.exe" --choose-folder'
Copy-Item README.md "dist\Luminor\README.md" -Force

Write-Host "4/4  Zip"
$zip = "dist\Luminor-$version-win64.zip"
if (Test-Path $zip) { Remove-Item $zip }
Compress-Archive -Path "dist\Luminor" -DestinationPath $zip
Write-Host "Done: dist\Luminor\Luminor.exe and $zip"
