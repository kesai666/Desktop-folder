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

$info = New-Object ShellIconExtract+SHFILEINFO
$size = [System.Runtime.InteropServices.Marshal]::SizeOf($info)
# SHGFI_ICON (0x100) | SHGFI_LARGEICON (0x0) —— 不带 USEFILEATTRIBUTES，才会解析 .lnk 的目标图标
$ok = [ShellIconExtract]::SHGetFileInfo($Path, 0, [ref]$info, $size, 0x100)
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
