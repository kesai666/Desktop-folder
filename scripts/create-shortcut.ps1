param(
  [string]$Link,
  [string]$Target
)

$ErrorActionPreference = 'Stop'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($Link)
$shortcut.TargetPath = $Target
$shortcut.Save()
Write-Output 'ok'
