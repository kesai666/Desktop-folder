param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('click', 'dblclick', 'drag', 'move', 'key', 'down', 'up', 'hotkey')]
  [string]$Action,
  [int]$X = 0,
  [int]$Y = 0,
  [int]$ToX = 0,
  [int]$ToY = 0,
  [int]$Key = 0x1B,
  [switch]$Ctrl,
  [switch]$Shift,
  [switch]$Alt,
  [int]$HoldMs = 0,
  [int]$Steps = 12
)

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class InputNative {
  [DllImport("user32.dll", SetLastError = true)] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
}
'@

try { [InputNative]::SetProcessDpiAwarenessContext([IntPtr](-4)) | Out-Null } catch { }

function Move-To([int]$mx, [int]$my) {
  [InputNative]::SetCursorPos($mx, $my) | Out-Null
  Start-Sleep -Milliseconds 20
}

function Left-Down { [InputNative]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero) }
function Left-Up { [InputNative]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero) }

switch ($Action) {
  'down' {
    if ($X -ne 0 -or $Y -ne 0) { Move-To $X $Y }
    Left-Down
    Write-Output 'mouse down'
  }
  'up' {
    Left-Up
    Write-Output 'mouse up'
  }
  'move' {
    Move-To $X $Y
    Write-Output "moved to $X,$Y"
  }
  'click' {
    Move-To $X $Y
    Left-Down
    Start-Sleep -Milliseconds 40
    Left-Up
    Write-Output "clicked $X,$Y"
  }
  'dblclick' {
    Move-To $X $Y
    Left-Down; Start-Sleep -Milliseconds 30; Left-Up
    Start-Sleep -Milliseconds 90
    Left-Down; Start-Sleep -Milliseconds 30; Left-Up
    Write-Output "double-clicked $X,$Y"
  }
  'drag' {
    Move-To $X $Y
    Left-Down
    for ($i = 1; $i -le $Steps; $i++) {
      $nx = [int]($X + ($ToX - $X) * $i / $Steps)
      $ny = [int]($Y + ($ToY - $Y) * $i / $Steps)
      [InputNative]::SetCursorPos($nx, $ny) | Out-Null
      Start-Sleep -Milliseconds 25
    }
    if ($HoldMs -gt 0) { Start-Sleep -Milliseconds $HoldMs }
    Left-Up
    Write-Output "dragged $X,$Y -> $ToX,$ToY"
  }
  'key' {
    [InputNative]::keybd_event([byte]$Key, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 30
    [InputNative]::keybd_event([byte]$Key, 0, 2, [UIntPtr]::Zero)
    Write-Output ("key 0x{0:X2} pressed" -f $Key)
  }
  'hotkey' {
    if ($Ctrl) { [InputNative]::keybd_event(0x11, 0, 0, [UIntPtr]::Zero) }
    if ($Shift) { [InputNative]::keybd_event(0x10, 0, 0, [UIntPtr]::Zero) }
    if ($Alt) { [InputNative]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero) }
    Start-Sleep -Milliseconds 30
    [InputNative]::keybd_event([byte]$Key, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 40
    [InputNative]::keybd_event([byte]$Key, 0, 2, [UIntPtr]::Zero)
    if ($Alt) { [InputNative]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero) }
    if ($Shift) { [InputNative]::keybd_event(0x10, 0, 2, [UIntPtr]::Zero) }
    if ($Ctrl) { [InputNative]::keybd_event(0x11, 0, 2, [UIntPtr]::Zero) }
    Write-Output ("hotkey ctrl={0} shift={1} alt={2} key=0x{3:X2}" -f $Ctrl, $Shift, $Alt, $Key)
  }
}
