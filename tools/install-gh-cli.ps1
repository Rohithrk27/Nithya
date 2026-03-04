param(
  [string]$InstallRoot = "tools/gh-cli"
)

$ErrorActionPreference = "Stop"

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$targetRoot = Join-Path $projectRoot $InstallRoot
New-Item -ItemType Directory -Force -Path $targetRoot | Out-Null

$existingExe = Join-Path $targetRoot "bin/gh.exe"
if (Test-Path $existingExe) {
  $exePath = $existingExe
} else {
  $release = Invoke-RestMethod -Uri "https://api.github.com/repos/cli/cli/releases/latest"
  $tag = [string]$release.tag_name
  if (-not $tag) {
    throw "Unable to resolve latest gh release tag."
  }

  $version = $tag.TrimStart("v")
  $zipName = "gh_${version}_windows_amd64.zip"
  $downloadUrl = "https://github.com/cli/cli/releases/download/$tag/$zipName"
  $zipPath = Join-Path $targetRoot $zipName

  Write-Host "Downloading $downloadUrl"
  Invoke-WebRequest -Uri $downloadUrl -OutFile $zipPath
  Expand-Archive -Path $zipPath -DestinationPath $targetRoot -Force
  Remove-Item -Force $zipPath

  $candidatePaths = @(
    (Join-Path $targetRoot "gh_${version}_windows_amd64/bin/gh.exe"),
    (Join-Path $targetRoot "bin/gh.exe")
  )
  $exePath = $candidatePaths | Where-Object { Test-Path $_ } | Select-Object -First 1
  if (-not $exePath) {
    throw "gh.exe not found after extraction."
  }
}

$wrapperPath = Join-Path $projectRoot "tools/gh-local.cmd"
$wrapperContent = @"
@echo off
setlocal
set "GH_BIN=$exePath"
if not exist "%GH_BIN%" (
  echo gh not found at "%GH_BIN%"
  exit /b 1
)
"%GH_BIN%" %*
exit /b %errorlevel%
"@
$wrapperContent | Out-File -FilePath $wrapperPath -Encoding ascii -Force

Write-Host "Installed gh CLI executable: $exePath"
Write-Host "Wrapper created: $wrapperPath"
