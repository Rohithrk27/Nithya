param(
  [string]$Folder = "store-assets/screenshots/android-phone",
  [double]$MaxRatio = 1.99,
  [string]$BackgroundHex = "#0B1220"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing

function Get-ImageFormat([string]$ext) {
  switch ($ext.ToLowerInvariant()) {
    ".png" { return [System.Drawing.Imaging.ImageFormat]::Png }
    ".jpg" { return [System.Drawing.Imaging.ImageFormat]::Jpeg }
    ".jpeg" { return [System.Drawing.Imaging.ImageFormat]::Jpeg }
    default { return $null }
  }
}

if (-not (Test-Path -LiteralPath $Folder)) {
  throw "Folder not found: $Folder"
}

$color = [System.Drawing.ColorTranslator]::FromHtml($BackgroundHex)
$files = Get-ChildItem -LiteralPath $Folder -File | Where-Object {
  @(".jpg", ".jpeg", ".png") -contains $_.Extension.ToLowerInvariant()
}

if ($files.Count -eq 0) {
  Write-Output "No image files found in $Folder"
  exit 0
}

foreach ($file in $files) {
  $image = $null
  $canvas = $null
  $graphics = $null
  try {
    $image = [System.Drawing.Image]::FromFile($file.FullName)
    $width = [int]$image.Width
    $height = [int]$image.Height
    $ratio = $height / [double]$width

    if ($ratio -lt $MaxRatio) {
      Write-Output ("OK  {0}  {1}x{2}  ratio={3:N3}" -f $file.Name, $width, $height, $ratio)
      continue
    }

    $targetWidth = [int][Math]::Ceiling($height / $MaxRatio)
    if ($targetWidth -le $width) {
      $targetWidth = $width + 1
    }

    $canvas = New-Object System.Drawing.Bitmap($targetWidth, $height)
    $graphics = [System.Drawing.Graphics]::FromImage($canvas)
    $graphics.Clear($color)
    $offsetX = [int][Math]::Floor(($targetWidth - $width) / 2.0)
    $graphics.DrawImage($image, $offsetX, 0, $width, $height)

    $tmpPath = [System.IO.Path]::Combine($file.DirectoryName, ($file.BaseName + ".fixed" + $file.Extension))
    if (Test-Path -LiteralPath $tmpPath) {
      Remove-Item -LiteralPath $tmpPath -Force
    }
    $format = Get-ImageFormat $file.Extension
    if ($null -eq $format) {
      Write-Output ("SKIP {0} unsupported format" -f $file.Name)
      continue
    }
    $canvas.Save($tmpPath, $format)

    if ($graphics -ne $null) { $graphics.Dispose(); $graphics = $null }
    if ($canvas -ne $null) { $canvas.Dispose(); $canvas = $null }
    if ($image -ne $null) { $image.Dispose(); $image = $null }

    $newRatio = $height / [double]$targetWidth
    Remove-Item -LiteralPath $file.FullName -Force
    Move-Item -LiteralPath $tmpPath -Destination $file.FullName
    Write-Output ("FIX {0}  {1}x{2} -> {3}x{4}  ratio={5:N3}" -f $file.Name, $width, $height, $targetWidth, $height, $newRatio)
  }
  finally {
    if ($graphics -ne $null) { $graphics.Dispose() }
    if ($canvas -ne $null) { $canvas.Dispose() }
    if ($image -ne $null) { $image.Dispose() }
  }
}
