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
