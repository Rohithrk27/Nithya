param(
  [string]$SourcePng = "public/logo/logo.png",
  [string]$ResRoot = "android/app/src/main/res"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing

function New-TransparentColor {
  param([System.Drawing.Color]$Color)
  return [System.Drawing.Color]::FromArgb(0, $Color.R, $Color.G, $Color.B)
}

function Remove-BlackBackground {
  param([System.Drawing.Bitmap]$InputBitmap)

  $output = [System.Drawing.Bitmap]::new(
    $InputBitmap.Width,
    $InputBitmap.Height,
    [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
  )

  for ($y = 0; $y -lt $InputBitmap.Height; $y += 1) {
    for ($x = 0; $x -lt $InputBitmap.Width; $x += 1) {
      $pixel = $InputBitmap.GetPixel($x, $y)
      if ($pixel.R -le 6 -and $pixel.G -le 6 -and $pixel.B -le 6) {
        $output.SetPixel($x, $y, (New-TransparentColor -Color $pixel))
      } else {
        $output.SetPixel($x, $y, $pixel)
      }
    }
  }

  return $output
}

function Get-AlphaBounds {
  param([System.Drawing.Bitmap]$Bitmap)

  $minX = $Bitmap.Width
  $minY = $Bitmap.Height
  $maxX = -1
  $maxY = -1

  for ($y = 0; $y -lt $Bitmap.Height; $y += 1) {
    for ($x = 0; $x -lt $Bitmap.Width; $x += 1) {
      $pixel = $Bitmap.GetPixel($x, $y)
      if ($pixel.A -gt 8) {
        if ($x -lt $minX) { $minX = $x }
        if ($y -lt $minY) { $minY = $y }
        if ($x -gt $maxX) { $maxX = $x }
        if ($y -gt $maxY) { $maxY = $y }
      }
    }
  }

  if ($maxX -lt 0 -or $maxY -lt 0) {
    return [System.Drawing.Rectangle]::new(0, 0, $Bitmap.Width, $Bitmap.Height)
  }

  return [System.Drawing.Rectangle]::new(
    $minX,
    $minY,
    ($maxX - $minX + 1),
    ($maxY - $minY + 1)
  )
}

function Save-IconPng {
  param(
    [System.Drawing.Bitmap]$SourceBitmap,
    [System.Drawing.Rectangle]$SourceRect,
    [int]$Size,
    [double]$Scale,
    [string]$OutputPath
  )

  $canvas = [System.Drawing.Bitmap]::new(
    $Size,
    $Size,
    [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
  )

  $graphics = [System.Drawing.Graphics]::FromImage($canvas)
  $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.Clear([System.Drawing.Color]::Transparent)

  $drawSize = [Math]::Max(1, [int][Math]::Round($Size * $Scale))
  $offset = [int][Math]::Round(($Size - $drawSize) / 2.0)
  $destRect = [System.Drawing.Rectangle]::new($offset, $offset, $drawSize, $drawSize)

  $graphics.DrawImage(
    $SourceBitmap,
    $destRect,
    $SourceRect.X,
    $SourceRect.Y,
    $SourceRect.Width,
    $SourceRect.Height,
    [System.Drawing.GraphicsUnit]::Pixel
  )

  $graphics.Dispose()

  $directory = [System.IO.Path]::GetDirectoryName($OutputPath)
  if (-not [string]::IsNullOrWhiteSpace($directory)) {
    [System.IO.Directory]::CreateDirectory($directory) | Out-Null
  }

  $canvas.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $canvas.Dispose()
}

if (-not (Test-Path -Path $SourcePng)) {
  throw "Source icon not found: $SourcePng"
}

$base = [System.Drawing.Bitmap]::new($SourcePng)
$clean = Remove-BlackBackground -InputBitmap $base
$sourceRect = [System.Drawing.Rectangle]::new(0, 0, $clean.Width, $clean.Height)

$regularSizes = @{
  "mdpi" = 48
  "hdpi" = 72
  "xhdpi" = 96
  "xxhdpi" = 144
  "xxxhdpi" = 192
}

$foregroundSizes = @{
  "mdpi" = 108
  "hdpi" = 162
  "xhdpi" = 216
  "xxhdpi" = 324
  "xxxhdpi" = 432
}

foreach ($density in $regularSizes.Keys) {
  $size = $regularSizes[$density]
  $folder = Join-Path $ResRoot "mipmap-$density"
  Save-IconPng -SourceBitmap $clean -SourceRect $sourceRect -Size $size -Scale 1.00 -OutputPath (Join-Path $folder "ic_launcher.png")
  Save-IconPng -SourceBitmap $clean -SourceRect $sourceRect -Size $size -Scale 1.00 -OutputPath (Join-Path $folder "ic_launcher_round.png")
}

foreach ($density in $foregroundSizes.Keys) {
  $size = $foregroundSizes[$density]
  $folder = Join-Path $ResRoot "mipmap-$density"
  # Keep the full logo inside adaptive icon safe zone to avoid launcher mask clipping.
  Save-IconPng -SourceBitmap $clean -SourceRect $sourceRect -Size $size -Scale 0.72 -OutputPath (Join-Path $folder "ic_launcher_foreground.png")
}

$base.Dispose()
$clean.Dispose()

Write-Output "Generated transparent Android launcher icons from $SourcePng"
