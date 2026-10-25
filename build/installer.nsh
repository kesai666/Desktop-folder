; 覆盖安装前先关掉旧进程，避免 electron-builder 卸载旧文件时报
; “Failed to uninstall old application files”。
!macro customInit
  nsExec::Exec 'taskkill /IM "${APP_EXECUTABLE_FILENAME}" /F'
  Pop $0
!macroend

; 安装时询问是否创建桌面 / 开始菜单快捷方式。
; 配合 package.json 里 createDesktopShortcut / createStartMenuShortcut = false 使用，
; 避免 electron-builder 默认静默创建。
!macro customInstall
  IfSilent skipShortcuts
  MessageBox MB_YESNO|MB_ICONQUESTION|MB_TOPMOST "要创建桌面和开始菜单快捷方式吗？" IDNO skipShortcuts
  CreateShortcut "$DESKTOP\${PRODUCT_NAME}.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  CreateShortcut "$SMPROGRAMS\${PRODUCT_NAME}.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  skipShortcuts:
!macroend

!macro customUnInstall
  Delete "$DESKTOP\${PRODUCT_NAME}.lnk"
  Delete "$SMPROGRAMS\${PRODUCT_NAME}.lnk"
!macroend
