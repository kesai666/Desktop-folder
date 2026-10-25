param(
  [int]$TimeoutSeconds = 120
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public class DropNative {
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vKey);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hWnd, uint flags);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder sb, int max);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
}
'@

try { [DropNative]::SetProcessDpiAwarenessContext([IntPtr](-4)) | Out-Null } catch { }

function Get-Class([IntPtr]$hwnd) {
  $sb = New-Object System.Text.StringBuilder 256
  [DropNative]::GetClassName($hwnd, $sb, 256) | Out-Null
  return $sb.ToString()
}

function Get-ProcessName([IntPtr]$hwnd) {
  $targetPid = 0
  [DropNative]::GetWindowThreadProcessId($hwnd, [ref]$targetPid) | Out-Null
  $p = Get-Process -Id $targetPid -ErrorAction SilentlyContinue
  if ($p) { return $p.ProcessName }
  return ''
}

$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
# 等鼠标左键松开；如果启动时已经松开，直接取当前位置（即落点）
while ((([DropNative]::GetAsyncKeyState(0x01)) -band 0x8000) -ne 0 -and (Get-Date) -lt $deadline) {
  Start-Sleep -Milliseconds 25
}

$pt = New-Object DropNative+POINT
[DropNative]::GetCursorPos([ref]$pt) | Out-Null

$hwnd = [DropNative]::WindowFromPoint($pt)
if ($hwnd -eq [IntPtr]::Zero) { Write-Output '{"kind":"other"}'; exit 0 }

$root = [DropNative]::GetAncestor($hwnd, 2)   # GA_ROOT
$rootClass = Get-Class $root
$rootProc = Get-ProcessName $root
$pointProc = Get-ProcessName $hwnd

$isDesktop = ($rootClass -eq 'Progman' -or $rootClass -eq 'WorkerW')

# 桌面的图标列表是 SHDLL_DefView 的子窗口
$cursor = $hwnd
for ($i = 0; $i -lt 6 -and $cursor -ne [IntPtr]::Zero; $i++) {
  $cls = Get-Class $cursor
  if ($cls -eq 'SHELLDLL_DefView') { $isDesktop = $true; break }
  $cursor = [DropNative]::GetAncestor($cursor, 1)  # GA_PARENT
}

if ($isDesktop) {
  Write-Output '{"kind":"desktop"}'
  exit 0
}

if ($rootProc -eq 'explorer' -and $pointProc -eq 'explorer') {
  try {
    $sh = New-Object -ComObject Shell.Application
    foreach ($w in $sh.Windows()) {
      try {
        $wHwnd = [int64]$w.HWND
        if ($wHwnd -eq $root.ToInt64()) {
          $path = $w.Document.Folder.Self.Path
          if ($path) {
            $json = @{ kind = 'folder'; path = [string]$path } | ConvertTo-Json -Compress
            Write-Output $json
            exit 0
          }
        }
      } catch { }
    }
  } catch { }
}

Write-Output '{"kind":"other"}'
