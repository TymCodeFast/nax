; Hooks NSIS d'electron-builder (inclus automatiquement depuis build/installer.nsh).
; NaX s'enregistre lui-même comme navigateur auprès de Windows au lancement (main.js, registerAsBrowser).
; À la désinstallation, on retire ces clés — sauf lors d'une mise à jour (l'ancienne version est désinstallée
; juste avant d'installer la nouvelle) : sinon Windows oublierait que NaX est le navigateur par défaut.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegKey HKCU "Software\Classes\NaXURL"
    DeleteRegKey HKCU "Software\Classes\NaXHTML"
    DeleteRegKey HKCU "Software\Clients\StartMenuInternet\NaX"
    DeleteRegValue HKCU "Software\RegisteredApplications" "NaX"
    DeleteRegValue HKCU "Software\Classes\.htm\OpenWithProgids" "NaXHTML"
    DeleteRegValue HKCU "Software\Classes\.html\OpenWithProgids" "NaXHTML"
    DeleteRegValue HKCU "Software\Classes\.shtml\OpenWithProgids" "NaXHTML"
    DeleteRegValue HKCU "Software\Classes\.xhtml\OpenWithProgids" "NaXHTML"
    DeleteRegValue HKCU "Software\Classes\.pdf\OpenWithProgids" "NaXHTML"
    DeleteRegValue HKCU "Software\Classes\.svg\OpenWithProgids" "NaXHTML"
    DeleteRegValue HKCU "Software\Classes\.webp\OpenWithProgids" "NaXHTML"
  ${endIf}
!macroend
