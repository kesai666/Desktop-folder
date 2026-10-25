#requires -Version 5.1
param(
  [string]$OutDir = "assets\tray"
)

Add-Type -AssemblyName System.Drawing

if (-not (Test-Path $OutDir)) {
  New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
}

function New-RoundedPath([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = [math]::Min($r * 2, [math]::Min($w, $h))
  $p.AddArc($x, $y, $d, $d, 180, 90)
  $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $p.CloseFigure()
  return $p
}

$sizes = @(16, 20, 24, 32, 40, 48, 64, 128, 256)
foreach ($size in $sizes) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.Clear([System.Drawing.Color]::Transparent)

  $inset = [math]::Max(1.0, $size * 0.045)
  $w = $size - 2 * $inset
  $rect = New-Object System.Drawing.RectangleF $inset, $inset, $w, $w
  $radius = $w * 0.29
  $path = New-RoundedPath $inset $inset $w $w $radius

  $bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    $rect,
    [System.Drawing.Color]::FromArgb(255, 126, 162, 255),
    [System.Drawing.Color]::FromArgb(255, 52, 64, 156),
    58
  )
  $g.FillPath($bg, $path)

  $outline = New-Object System.Drawing.Pen(
    [System.Drawing.Color]::FromArgb(70, 255, 255, 255),
    [math]::Max(0.7, $size * 0.012)
  )
  $g.DrawPath($outline, $path)

  $grid = $w * 0.60
  $gap = $grid * 0.12
  $tile = ($grid - 2 * $gap) / 3
  $start = ($size - $grid) / 2
  $white = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(246, 255, 255, 255))
  for ($row = 0; $row -lt 3; $row++) {
    for ($col = 0; $col -lt 3; $col++) {
      $x = $start + $col * ($tile + $gap)
      $y = $start + $row * ($tile + $gap)
      $tilePath = New-RoundedPath $x $y $tile $tile ($tile * 0.26)
      $g.FillPath($white, $tilePath)
    }
  }

  $out = Join-Path $OutDir ("tray-{0}.png" -f $size)
  $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose()
  $bmp.Dispose()
  Write-Output "saved $out"
}
