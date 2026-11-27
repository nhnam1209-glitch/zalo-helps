# Build public/zalo-guard-extension.zip from zalo-guard-extension/ (standard ZIP, manifest.json at the root).
# Uses .NET directly so entry names always use "/" with no "./" prefix and no directory entries.
# NOTE: keep this file ASCII-only (Windows PowerShell 5.1 reads BOM-less files as ANSI).
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$root = Split-Path -Parent $PSScriptRoot
$src = Join-Path $root 'zalo-guard-extension'
$out = Join-Path $root 'public\zalo-guard-extension.zip'
$junk = @('Thumbs.db', 'desktop.ini', '.DS_Store', '*.map', '*.log', '*.tmp', '*.bak', '*~')

if (Test-Path $out) { Remove-Item $out -Force }
$files = @(Get-ChildItem $src -Recurse -File -Force -Exclude $junk |
  Where-Object { $_.FullName -notmatch '[\\/](\.git|node_modules)[\\/]' } |
  Sort-Object @{ Expression = { $_.FullName.Substring($src.Length + 1) -ne 'manifest.json' } }, FullName)

if (-not ($files | Where-Object { $_.Name -eq 'manifest.json' -and $_.DirectoryName -eq $src })) {
  throw 'manifest.json is missing at the extension root.'
}

$zip = [IO.Compression.ZipFile]::Open($out, [IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($f in $files) {
    $name = $f.FullName.Substring($src.Length + 1).Replace('\', '/')
    [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $f.FullName, $name, [IO.Compression.CompressionLevel]::Optimal)
  }
} finally {
  $zip.Dispose()
}
Write-Host ("Built {0} file(s) into public/zalo-guard-extension.zip" -f $files.Count)
