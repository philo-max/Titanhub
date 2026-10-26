Unicode true
SilentInstall silent
RequestExecutionLevel user
OutFile "${OUT_FILE}"

!include LogicLib.nsh
!include FileFunc.nsh

Function atomicRMDir
  Exch $R0
  Push $R1
  Push $R2
  Push $R3
  StrCpy $R3 "$INSTDIR$R0\*.*"
  FindFirst $R1 $R2 $R3
  loop:
    StrCmp $R2 "" break
    StrCmp $R2 "." continue
    StrCmp $R2 ".." continue
    IfFileExists "$INSTDIR$R0\$R2\*.*" isDir isNotDir
    isDir:
      CreateDirectory "$PLUGINSDIR\old-install$R0\$R2"
      Push "$R0\$R2"
      Call atomicRMDir
      Pop $R3
      ${if} $R3 != 0
        Goto done
      ${endIf}
      Goto continue
    isNotDir:
      ClearErrors
      Rename "$INSTDIR$R0\$R2" "$PLUGINSDIR\old-install$R0\$R2"
      IfErrors 0 +3
      StrCpy $R3 "$INSTDIR$R0\$R2"
      Goto done
    continue:
      FindNext $R1 $R2
      Goto loop
  break:
    StrCpy $R3 0
  done:
    FindClose $R1
    StrCpy $R0 $R3
    Pop $R3
    Pop $R2
    Pop $R1
    Exch $R0
FunctionEnd

Function restoreFiles
  Exch $R0
  Push $R1
  Push $R2
  Push $R3
  StrCpy $R3 "$PLUGINSDIR\old-install$R0\*.*"
  FindFirst $R1 $R2 $R3
  loop:
    StrCmp $R2 "" break
    StrCmp $R2 "." continue
    StrCmp $R2 ".." continue
    IfFileExists "$INSTDIR$R0\$R2\*.*" isDir isNotDir
    isDir:
      CreateDirectory "$INSTDIR$R0\$R2"
      Push "$R0\$R2"
      Call restoreFiles
      Pop $R3
      Goto continue
    isNotDir:
      Rename "$PLUGINSDIR\old-install$R0\$R2" "$INSTDIR$R0\$R2"
    continue:
      FindNext $R1 $R2
      Goto loop
  break:
    StrCpy $R0 0
    FindClose $R1
    Pop $R3
    Pop $R2
    Pop $R1
    Exch $R0
FunctionEnd

Section
  ${GetParameters} $0
  ${GetOptions} $0 "/LOG=" $1
  ${GetOptions} $0 "/SRC=" $INSTDIR
  ${If} $INSTDIR == ""
    SetErrorLevel 3
    Quit
  ${EndIf}

  InitPluginsDir
  ReadEnvStr $3 TEMP
  ReadEnvStr $4 TMP

  CreateDirectory "$PLUGINSDIR\old-install"
  Push ""
  Call atomicRMDir
  Pop $5
  Push ""
  Call restoreFiles
  Pop $6

  FileOpen $6 "$1" w
  FileWrite $6 "TEMP=$3$\r$\nTMP=$4$\r$\nPLUGINSDIR=$PLUGINSDIR$\r$\nBUSY=$5$\r$\n"
  FileClose $6

  ${If} $5 != 0
    SetErrorLevel 2
  ${EndIf}
SectionEnd
