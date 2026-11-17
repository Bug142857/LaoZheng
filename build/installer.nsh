; 自定义卸载页：默认保留个人数据，用户可勾选清除
; 通过 package.json 的 nsis.include 引入，只在卸载程序中生效

!ifdef BUILD_UNINSTALLER

!include nsDialogs.nsh

Var unDeletePersonalData

!macro customUnWelcomePage
  UninstPage custom un.personalDataPageCreate un.personalDataPageLeave

  Function un.personalDataPageCreate
    !insertmacro MUI_HEADER_TEXT "卸载 $(^NameDA)" "选择是否保留个人数据"

    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}

    ${NSD_CreateLabel} 0 0 100% 40u "卸载会移除程序文件、开始菜单与桌面快捷方式。$\r$\n$\r$\n个人数据（清单、收藏、登录状态、设置、下载记录）默认保留，重新安装后可以继续使用。"
    Pop $0

    ${NSD_CreateCheckbox} 0 56u 100% 12u "同时清除个人数据（不会删除已下载的视频、漫画、音乐、图书文件）"
    Pop $unDeletePersonalData
    ${NSD_SetState} $unDeletePersonalData ${BST_UNCHECKED}

    ${NSD_CreateLabel} 0 78u 100% 24u "清除后无法恢复，建议先在应用内「数据管理」中导出备份。"
    Pop $0

    nsDialogs::Show
  FunctionEnd

  Function un.personalDataPageLeave
    ${NSD_GetState} $unDeletePersonalData $unDeletePersonalData
  FunctionEnd
!macroend

!macro customUnInstall
  ${IfNot} ${isUpdated}
    ${If} $unDeletePersonalData == ${BST_CHECKED}
      ${If} $installMode == "all"
        SetShellVarContext current
      ${EndIf}
      RMDir /r "$APPDATA\laozheng-pc"
      ${If} $installMode == "all"
        SetShellVarContext all
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend

!endif

; 安装 / 覆盖升级结束：重建已存在的快捷方式（快捷方式路径放在 $R0）
!macro refreshShortcutLink
  ${if} ${FileExists} "$R0"
    CreateShortCut "$R0" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
    ClearErrors
    WinShell::SetLnkAUMI "$R0" "${APP_ID}"
  ${endIf}
!macroend

; electron-builder 在覆盖升级时默认保留旧快捷方式（KeepShortcuts 机制），
; 安装目录变化后快捷方式仍指向旧版本；这里对已存在的快捷方式强制重建为
; 本次安装路径（不存在时不主动创建，尊重用户自行删除），覆盖桌面、开始菜单、
; 任务栏固定与快速启动等所有常见位置（当前用户 + 所有用户两种上下文）。
!macro customInstall
  # 桌面：当前用户 / 所有用户
  !ifndef DO_NOT_CREATE_DESKTOP_SHORTCUT
    SetShellVarContext current
    StrCpy $R0 "$DESKTOP\${SHORTCUT_NAME}.lnk"
    !insertmacro refreshShortcutLink
    SetShellVarContext all
    StrCpy $R0 "$DESKTOP\${SHORTCUT_NAME}.lnk"
    !insertmacro refreshShortcutLink
  !endif
  # 开始菜单：当前用户 / 所有用户
  !ifndef DO_NOT_CREATE_START_MENU_SHORTCUT
    SetShellVarContext current
    StrCpy $R0 "$SMPROGRAMS\${SHORTCUT_NAME}.lnk"
    !insertmacro refreshShortcutLink
    SetShellVarContext all
    StrCpy $R0 "$SMPROGRAMS\${SHORTCUT_NAME}.lnk"
    !insertmacro refreshShortcutLink
  !endif
  # 任务栏固定 / 开始菜单固定 / 快速启动（当前用户）
  SetShellVarContext current
  StrCpy $R0 "$APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\${SHORTCUT_NAME}.lnk"
  !insertmacro refreshShortcutLink
  StrCpy $R0 "$APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\StartMenu\${SHORTCUT_NAME}.lnk"
  !insertmacro refreshShortcutLink
  StrCpy $R0 "$APPDATA\Microsoft\Internet Explorer\Quick Launch\${SHORTCUT_NAME}.lnk"
  !insertmacro refreshShortcutLink
  # 还原 shell 上下文，避免影响后续安装逻辑
  ${if} $installMode == "all"
    SetShellVarContext all
  ${else}
    SetShellVarContext current
  ${endif}
  System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
!macroend
