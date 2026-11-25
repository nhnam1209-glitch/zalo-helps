# Đóng gói zalo-guard-extension thành public/zalo-guard-extension.zip (ZIP chuẩn, manifest.json ở cấp gốc).
# Dùng .NET trực tiếp để tên entry luôn dùng "/" và không có tiền tố "./" hay entry thư mục.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$root = Split-Path -Parent $PSScriptRoot
$src = Join-Path $root 'zalo-guard-extension'
$out = Join-Path $root 'public\zalo-guard-extension.zip'

if (Test-Path $out) { Remove-Item $out -Force }
$zip = [IO.Compression.ZipFile]::Open($out, [IO.Compression.ZipArchiveMode]::Create)
try {
  Get-ChildItem $src -Recurse -File | ForEach-Object {
    $name = $_.FullName.Substring($src.Length + 1).Replace('\', '/')
    [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $name, [IO.Compression.CompressionLevel]::Optimal)
  }
} finally {
  $zip.Dispose()
}
Write-Host "Đã tạo $out"
