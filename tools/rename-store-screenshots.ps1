param(
  [string]$SourceDir = "store-assets/screenshots/raw",
  [string]$TargetDir = "store-assets/screenshots/android-phone"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $SourceDir)) {
  throw "Source directory not found: $SourceDir"
}

if (-not (Test-Path $TargetDir)) {
  New-Item -ItemType Directory -Path $TargetDir -Force | Out-Null
}

$files = Get-ChildItem -Path $SourceDir -File |
  Where-Object { $_.Extension -match '^\.(png|jpg|jpeg|webp)$' } |
  Sort-Object Name

if ($files.Count -lt 3) {
  throw "Need at least 3 screenshot files in $SourceDir. Found: $($files.Count)"
}

$targets = @(
  "01_navigation-menu.jpg",
  "02_landing-screen.jpg",
  "03_profile-stats.jpg"
)

for ($i = 0; $i -lt $targets.Count; $i++) {
  $dest = Join-Path $TargetDir $targets[$i]
  Copy-Item -LiteralPath $files[$i].FullName -Destination $dest -Force
  Write-Host "Saved $dest"
}
