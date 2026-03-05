param(
  [string]$Tag = "v1.0.0",
  [string]$Repo = "Rohithrk27/Nithya",
  [string]$Title = "Nithya v1.0.0",
  [string]$NotesFile = "release-apk-files/RELEASE_NOTES-v1.0.md"
)

$ErrorActionPreference = "Stop"

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $projectRoot

$ghCmd = Join-Path $projectRoot "tools/gh-local.cmd"
if (-not (Test-Path $ghCmd)) {
  throw "Missing gh wrapper at tools/gh-local.cmd. Run tools/install-gh-cli.ps1 first."
}

$token = $env:GH_TOKEN
if (-not $token) {
  $token = $env:GITHUB_TOKEN
}
if ($token) {
  $env:GH_TOKEN = $token
  Write-Host "Using GH token from environment."
} else {
  & $ghCmd auth status *> $null
  if ($LASTEXITCODE -ne 0) {
    throw "GitHub auth required. Run 'tools\gh-local.cmd auth login' or set GH_TOKEN/GITHUB_TOKEN, then rerun."
  }
  Write-Host "Using existing gh auth session."
}

$requiredAssets = @(
  "release-apk-files/Nithya.apk",
  "release-apk-files/SHA256SUMS.txt",
  "release-apk-files/RELEASE_NOTES-v1.0.md"
)
$optionalAssets = @(
  "release-apk-files/app-release-signed-v1.0.apk",
  "release-apk-files/app-release-signed-v1.0.aab",
  "release-apk-files/upload_certificate.pem"
)

$assets = @()
foreach ($asset in $requiredAssets) {
  if (-not (Test-Path $asset)) {
    throw "Missing release asset: $asset"
  }
  $assets += $asset
}
foreach ($asset in $optionalAssets) {
  if (Test-Path $asset) {
    $assets += $asset
  }
}
if (-not (Test-Path $NotesFile)) {
  throw "Missing notes file: $NotesFile"
}

& $ghCmd release view $Tag --repo $Repo *> $null
if ($LASTEXITCODE -eq 0) {
  Write-Host "Release $Tag already exists. Uploading assets with clobber."
  & $ghCmd release upload $Tag @assets --repo $Repo --clobber
  if ($LASTEXITCODE -ne 0) {
    throw "Failed uploading assets to existing release."
  }
  exit 0
}

Write-Host "Creating release $Tag in $Repo"
& $ghCmd release create $Tag @assets --repo $Repo --title $Title --notes-file $NotesFile --latest
if ($LASTEXITCODE -ne 0) {
  throw "Failed creating GitHub release."
}
