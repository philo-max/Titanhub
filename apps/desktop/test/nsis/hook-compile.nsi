Unicode true
SilentInstall silent
RequestExecutionLevel user
OutFile "${OUT_FILE}"

!define INSTALL_REGISTRY_KEY "Software\titanhub-nsis-hook-fixture-absent"
!define UNINSTALL_REGISTRY_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\titanhub-nsis-hook-fixture-absent"

!include "${INCLUDE_FILE}"

Function .onInit
  !ifndef BUILD_UNINSTALLER
    !insertmacro customInit
  !endif
FunctionEnd

Section
  !ifndef BUILD_UNINSTALLER
    !insertmacro customInstall
  !endif
SectionEnd
