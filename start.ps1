# Start Luminor and open it in the default browser.
#   .\start.ps1                 # port 8770, default data folder
#   .\start.ps1 -Port 9000 -DataDir "D:\scans"
param([int]$Port = 8770, [string]$DataDir = '')

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$condaPython = Join-Path $env:USERPROFILE 'anaconda3\envs\DICOM\python.exe'
$python = if (Test-Path $condaPython) { $condaPython } else { 'python' }

$serverArgs = @((Join-Path $here 'server.py'), '--port', $Port)
if ($DataDir) { $serverArgs += @('--data', $DataDir) }

Start-Job -ScriptBlock { param($p) Start-Sleep -Seconds 2; Start-Process "http://127.0.0.1:$p/" } -ArgumentList $Port | Out-Null
& $python @serverArgs
