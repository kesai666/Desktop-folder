param(
  [string]$Out = 'capture.png',
  [int]$X = -2147483648,
  [int]$Y = -2147483648,
  [int]$W = 0,
  [int]$H = 0,
  [int]$CropX = -2147483648,
  [int]$CropY = -2147483648,
  [int]$CropW = 0,
  [int]$CropH = 0,
  [int]$Scale = 1
)

Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class ScreenShotNative {
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int nIndex);
  [DllImport("user32.dll", SetLastError = true)] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
}
'@

# 让本进程感知 DPI：否则 GetSystemMetrics / CopyFromScreen 拿到的是被虚拟化的 DIP，截图会被裁成左上 2/3
try { [ScreenShotNative]::SetProcessDpiAwarenessContext([IntPtr](-4)) | Out-Null } catch { }

$vx = [ScreenShotNative]::GetSystemMetrics(76)
$vy = [ScreenShotNative]::GetSystemMetrics(77)
$vw = [ScreenShotNative]::GetSystemMetrics(78)
$vh = [ScreenShotNative]::GetSystemMetrics(79)

if ($X -eq -2147483648) { $X = $vx }
if ($Y -eq -2147483648) { $Y = $vy }
if ($W -le 0) { $W = $vw }
if ($H -le 0) { $H = $vh }

$bmp = New-Object System.Drawing.Bitmap($W, $H)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($X, $Y, 0, 0, (New-Object System.Drawing.Size($W, $H)))
$g.Dispose()

if ($CropX -ne -2147483648 -and $CropW -gt 0 -and $CropH -gt 0) {
  $cropRect = New-Object System.Drawing.Rectangle($CropX, $CropY, $CropW, $CropH)
  $cropped = $bmp.Clone($cropRect, $bmp.PixelFormat)
  $bmp.Dispose()
  $bmp = $cropped
  if ($Scale -gt 1) {
    $scaled = New-Object System.Drawing.Bitmap(($CropW * $Scale), ($CropH * $Scale))
    $sg = [System.Drawing.Graphics]::FromImage($scaled)
    $sg.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $sg.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $sg.DrawImage($bmp, 0, 0, $scaled.Width, $scaled.Height)
    $sg.Dispose()
    $bmp.Dispose()
    $bmp = $scaled
  }
}

$full = Join-Path (Get-Location) $Out
$dir = Split-Path $full -Parent
if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
$outW = $bmp.Width
$outH = $bmp.Height
$bmp.Save($full, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Output "saved $full (${outW}x${outH}, source ${W}x${H} from $X,$Y)"
