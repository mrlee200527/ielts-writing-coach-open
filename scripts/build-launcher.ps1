# Builds dist\IELTS Writing Coach.exe from launcher\Program.cs using the
# .NET Framework csc.exe shipped with Windows (no extra tooling required).
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$csc = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path $csc)) {
    throw "csc.exe not found at $csc (requires .NET Framework 4.x, present on Windows 10/11)"
}

$dist = Join-Path $root "dist"
New-Item -ItemType Directory -Force -Path $dist | Out-Null

$out = Join-Path $dist "IELTS Writing Coach.exe"
$source = Join-Path $root "launcher\Program.cs"

& $csc /nologo /target:winexe /r:System.Windows.Forms.dll /r:System.Drawing.dll "/out:$out" $source
if ($LASTEXITCODE -ne 0) {
    throw "csc.exe failed with exit code $LASTEXITCODE"
}

Write-Output "Built $out"
