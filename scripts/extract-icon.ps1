param(
  [string]$Path,
  [string]$Out
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Drawing;
using System.Drawing.Imaging;
public class ShellIconExtract {
  [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
  public static extern IntPtr SHGetFileInfo(string path, uint attr, out SHFILEINFO info, uint size, uint flags);
  [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
  public static extern int ExtractIconEx(string file, int index, IntPtr[] large, IntPtr[] small, int count);
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

function Save-IconHandle {
  param([IntPtr]$Handle, [string]$OutPath)
  if ($Handle -eq [IntPtr]::Zero) { return $false }
  $icon = [System.Drawing.Icon]::FromHandle($Handle)
  $bmp = $icon.ToBitmap()
  $bmp.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  $icon.Dispose()
  [ShellIconExtract]::DestroyIcon($Handle) | Out-Null
  return $true
}

# 快捷方式：解析真实目标。
# 普通程序/文件夹取 TargetPath；「此电脑」「回收站」这类是 shell 命名空间，
# TargetPath 为空、Target.Path 是 ::{CLSID}，需要查注册表 DefaultIcon。
$lookup = $Path
$iconLocation = ''
$ext = [System.IO.Path]::GetExtension($Path).ToLowerInvariant()
if ($ext -eq '.lnk') {
  try {
    $shell = New-Object -ComObject Shell.Application
    $folder = $shell.Namespace([System.IO.Path]::GetDirectoryName($Path))
    $item = $folder.ParseName([System.IO.Path]::GetFileName($Path))
    $link = $item.GetLink
    $target = $link.Target
    if ($target -and $target.Path) { $lookup = $target.Path }
  } catch { }
  try {
    $shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut($Path)
    if ($shortcut.IconLocation) { $iconLocation = $shortcut.IconLocation }
    if (($lookup -eq $Path) -and $shortcut.TargetPath) { $lookup = $shortcut.TargetPath }
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

# custom icon (e.g. .ico) takes priority over the target icon
if ($iconLocation) {
  $customPath = ($iconLocation -split ',')[0].Trim().Trim('"')
  $customPath = [Environment]::ExpandEnvironmentVariables($customPath)
  if ($customPath -and (Test-Path -LiteralPath $customPath)) { $lookup = $customPath }
}

# shell 命名空间（::{CLSID}）：查注册表里的 DefaultIcon
if ($lookup -like '::*') {
  $clsid = $lookup.Substring(2).Trim()
  try {
    $defaultIcon = (Get-ItemProperty -Path "Registry::HKEY_CLASSES_ROOT\CLSID\$clsid\DefaultIcon" -ErrorAction Stop).'(default)'
    if ($defaultIcon -match '^(?<file>.+?),(?<index>-?\d+)\s*$') {
      $iconFile = [Environment]::ExpandEnvironmentVariables($Matches['file'].Trim().Trim('"'))
      $iconIndex = [int]$Matches['index']
      if (Test-Path -LiteralPath $iconFile) {
        $large = New-Object IntPtr[] 1
        $small = New-Object IntPtr[] 1
        $count = [ShellIconExtract]::ExtractIconEx($iconFile, $iconIndex, $large, $small, 1)
        if ($count -gt 0 -and (Save-IconHandle $large[0] $Out)) { exit 0 }
      }
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

Save-IconHandle $info.hIcon $Out | Out-Null
Write-Output 'ok'
