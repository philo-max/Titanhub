!include LogicLib.nsh

!define TITANHUB_SHORT_TEMP_PREFIX "th-"
!define TITANHUB_SHORT_TEMP_NAME_LENGTH 6
!define TITANHUB_SHORT_TEMP_ATTEMPTS 8
!define TITANHUB_SHORT_TEMP_SDDL "D:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;OICI;FA;;;OW)"
!define TITANHUB_SDDL_REVISION 1
!define TITANHUB_ERROR_ALREADY_EXISTS 183

!if ${NSIS_PTR_SIZE} > 4
  !error "installer.nsh builds SECURITY_ATTRIBUTES with the 32-bit layout"
!endif

!macro titanhubSetEnv NAME VALUE
  ${If} ${VALUE} == ""
    System::Call 'kernel32::SetEnvironmentVariableW(w "${NAME}", p 0)'
  ${Else}
    System::Call 'kernel32::SetEnvironmentVariableW(w "${NAME}", w "${VALUE}")'
  ${EndIf}
!macroend

!ifndef BUILD_UNINSTALLER
  Var titanhubUpgradeTemp
  Var titanhubOriginalTemp
  Var titanhubOriginalTmp
  Var titanhubCreateResult

  Function titanhubTryCreateShortTemp
    Exch $0
    Push $1
    Push $2
    Push $3
    StrCpy $titanhubCreateResult "failed"
    System::Call 'advapi32::ConvertStringSecurityDescriptorToSecurityDescriptorW(w "${TITANHUB_SHORT_TEMP_SDDL}", i ${TITANHUB_SDDL_REVISION}, *p .r1, p 0) i .r2'
    ${If} $2 <> 0
      System::Call '*(&l4, p r1, i 0) p .r2'
      System::Call 'kernel32::CreateDirectoryW(w r0, p r2) i .r3 ?e'
      Pop $0
      System::Free $2
      System::Call 'kernel32::LocalFree(p r1)'
      ${If} $3 <> 0
        StrCpy $titanhubCreateResult "created"
      ${ElseIf} $0 = ${TITANHUB_ERROR_ALREADY_EXISTS}
        StrCpy $titanhubCreateResult "exists"
      ${EndIf}
    ${EndIf}
    Pop $3
    Pop $2
    Pop $1
    Pop $0
  FunctionEnd

  Function titanhubCreateShortTempOnDrive
    Exch $0
    Push $1
    Push $2
    ${For} $1 1 ${TITANHUB_SHORT_TEMP_ATTEMPTS}
      System::Call 'ole32::CoCreateGuid(g .r2)'
      StrCpy $2 $2 ${TITANHUB_SHORT_TEMP_NAME_LENGTH} 1
      StrCpy $2 "$0\${TITANHUB_SHORT_TEMP_PREFIX}$2"
      Push $2
      Call titanhubTryCreateShortTemp
      ${If} $titanhubCreateResult == "created"
        StrCpy $titanhubUpgradeTemp $2
        ${ExitFor}
      ${ElseIf} $titanhubCreateResult == "failed"
        ${ExitFor}
      ${EndIf}
    ${Next}
    Pop $2
    Pop $1
    Pop $0
  FunctionEnd

  Function titanhubPrepareUpgradeTemp
    Exch $0
    Exch
    Exch $1
    Push $2
    Push $3
    StrCpy $titanhubUpgradeTemp ""
    ${If} $0 != ""
      StrCpy $3 ""
      StrCpy $2 $0 1 1
      ${If} $2 == ":"
        StrCpy $3 $0 2
        Push $3
        Call titanhubCreateShortTempOnDrive
      ${EndIf}
      StrCpy $2 $1 2
      ${If} $titanhubUpgradeTemp == ""
      ${AndIf} $2 != $3
        Push $2
        Call titanhubCreateShortTempOnDrive
      ${EndIf}
      ${If} $titanhubUpgradeTemp == ""
        MessageBox MB_OK|MB_ICONSTOP "Setup could not create a short temporary folder in the root of $3 or $2.$\r$\nThe previous version cannot be upgraded without it. Setup will exit without changing anything." /SD IDOK
        SetErrorLevel 2
        Quit
      ${EndIf}
      ReadEnvStr $titanhubOriginalTemp TEMP
      ReadEnvStr $titanhubOriginalTmp TMP
      !insertmacro titanhubSetEnv TEMP $titanhubUpgradeTemp
      !insertmacro titanhubSetEnv TMP $titanhubUpgradeTemp
    ${EndIf}
    Pop $3
    Pop $2
    Pop $1
    Pop $0
  FunctionEnd

  Function titanhubRestoreUpgradeTemp
    ${If} $titanhubUpgradeTemp != ""
      !insertmacro titanhubSetEnv TEMP $titanhubOriginalTemp
      !insertmacro titanhubSetEnv TMP $titanhubOriginalTmp
      ClearErrors
      RMDir $titanhubUpgradeTemp
      ${If} ${Errors}
        DetailPrint "Upgrade temp folder is not empty and was left in place: $titanhubUpgradeTemp"
      ${EndIf}
      StrCpy $titanhubUpgradeTemp ""
    ${EndIf}
  FunctionEnd

  Function .onGUIEnd
    Call titanhubRestoreUpgradeTemp
  FunctionEnd
!endif

!macro titanhubReadOldUninstallString ROOT_KEY
  ${If} $0 == ""
    ReadRegStr $0 ${ROOT_KEY} "${UNINSTALL_REGISTRY_KEY}" UninstallString
  ${EndIf}
  !ifdef UNINSTALL_REGISTRY_KEY_2
    ${If} $0 == ""
      ReadRegStr $0 ${ROOT_KEY} "${UNINSTALL_REGISTRY_KEY_2}" UninstallString
    ${EndIf}
  !endif
!macroend

!macro customInit
  Push $0
  Push $1
  StrCpy $0 ""
  !insertmacro titanhubReadOldUninstallString HKCU
  !insertmacro titanhubReadOldUninstallString HKLM
  ${If} $0 != ""
    ReadRegStr $1 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
    ${If} $1 == ""
      ReadRegStr $1 HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation
    ${EndIf}
    ${If} $1 == ""
      StrCpy $1 $WINDIR
    ${EndIf}
    Push $WINDIR
    Push $1
    Call titanhubPrepareUpgradeTemp
  ${EndIf}
  Pop $1
  Pop $0
!macroend

!macro customInstall
  Call titanhubRestoreUpgradeTemp
!macroend
