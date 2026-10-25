param(
  [string]$Path,
  [string]$Out
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public class ShellIconExtract {
  [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
  public static extern IntPtr SHGetFileInfo(string path, uint attr, out SHFILEINFO info, uint size, uint flags);
  [DllImport("user32.dll")]
  public static extern bool DestroyIcon(IntPtr h);
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct SHFILEINFO {
    public IntPtr hIcon;
    public int iIcon;
    public uint dwAttributes;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string szDisplayName;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 80)] public string szTypeName;
  }
}
'@

# 快捷方式：解析到真实目标再取图标。
# 直接对 .lnk 调用 SHGetFileInfo，Windows 会叠加左下角快捷方式箭头；
# 目标程序/文件夹的图标本身没有箭头，所以先解析 TargetPath（或 .url 的 IconFile）。
$lookup = $Path
$ext = [System.IO.Path]::GetExtension($Path).ToLowerInvariant()
if ($ext -eq '.lnk') {
  try {
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($Path)
    if ($shortcut.TargetPath -and (Test-Path -LiteralPath $shortcut.TargetPath)) {
      $lookup = $shortcut.TargetPath
    } elseif ($shortcut.IconLocation) {
      $iconPath = ($shortcut.IconLocation -split ',')[0].Trim().Trim('"')
      if ($iconPath -and (Test-Path -LiteralPath $iconPath)) { $lookup = $iconPath }
    }
  } catch { }
} elseif ($ext -eq '.url') {
  try {
    $ini = Get-Content -LiteralPath $Path -Raw
    if ($ini -match '(?im)^\s*IconFile\s*=\s*(.+?)\s*$') {
      $iconPath = $Matches[1].Trim().Trim('"')
      if ($iconPath -and (Test-Path -LiteralPath $iconPath)) { $lookup = $iconPath }
    }
  } catch { }
}

$info = New-Object ShellIconExtract+SHFILEINFO
$size = [System.Runtime.InteropServices.Marshal]::SizeOf($info)
# SHGFI_ICON (0x100) | SHGFI_LARGEICON (0x0)；不带 LINKOVERLAY
$ok = [ShellIconExtract]::SHGetFileInfo($lookup, 0, [ref]$info, $size, 0x100)
if ($info.hIcon -eq [IntPtr]::Zero) {
  if ($ok -eq 0) { exit 3 }
  exit 4
}

$icon = [System.Drawing.Icon]::FromHandle($info.hIcon)
$bmp = $icon.ToBitmap()
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
$icon.Dispose()
[ShellIconExtract]::DestroyIcon($info.hIcon) | Out-Null
Write-Output 'ok'
