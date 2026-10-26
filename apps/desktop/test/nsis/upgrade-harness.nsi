Unicode true
SilentInstall silent
RequestExecutionLevel user
OutFile "${OUT_FILE}"

!include LogicLib.nsh
!include FileFunc.nsh
!include "${INCLUDE_FILE}"

Function writeHarnessLog
  Exch $R0
  FileOpen $R1 "$R5\harness.log" a
  FileSeek $R1 0 END
  FileWrite $R1 "$R0$\r$\n"
  FileClose $R1
  Pop $R0
FunctionEnd

Section
  ${GetParameters} $R9
  ${GetOptions} $R9 "/MODE=" $R8
  ${GetOptions} $R9 "/OLD_DIR=" $R7
  ${GetOptions} $R9 "/FALLBACK=" $R6
  ${GetOptions} $R9 "/OUT=" $R5
  ${GetOptions} $R9 "/MOCK=" $R4
  ${GetOptions} $R9 "/DIR=" $R3

  ${If} $R8 == "try-create"
    Push $R3
    Call titanhubTryCreateShortTemp
    Push "CREATE=$titanhubCreateResult"
    Call writeHarnessLog
    Return
  ${EndIf}

  Push $R6
  Push $R7
  Call titanhubPrepareUpgradeTemp
  Push "PREPARED=$titanhubUpgradeTemp"
  Call writeHarnessLog
  ReadEnvStr $R2 TEMP
  Push "TEMP_NOW=$R2"
  Call writeHarnessLog
  ReadEnvStr $R2 TMP
  Push "TMP_NOW=$R2"
  Call writeHarnessLog

  ${If} $R8 == "prepare-only"
    Return
  ${EndIf}

  ExecWait '"$R4" /LOG=$R5\during.log /SRC=$R7' $R2
  Push "DURING_EXIT=$R2"
  Call writeHarnessLog

  StrCpy $R1 $titanhubUpgradeTemp
  Call titanhubRestoreUpgradeTemp
  ${If} ${FileExists} "$R1\*.*"
    Push "SHORT_TEMP_LEFT=yes"
  ${Else}
    Push "SHORT_TEMP_LEFT=no"
  ${EndIf}
  Call writeHarnessLog

  ExecWait '"$R4" /LOG=$R5\after.log /SRC=$R7' $R2
  Push "AFTER_EXIT=$R2"
  Call writeHarnessLog
SectionEnd
