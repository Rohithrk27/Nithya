@echo off
setlocal
set "ADB_HOME=d:\Nithya\.adb-home"
if not exist "%ADB_HOME%" mkdir "%ADB_HOME%"
set "USERPROFILE=%ADB_HOME%"
set "HOME=%ADB_HOME%"
set "ANDROID_SDK_HOME=%ADB_HOME%"
set "HOMEDRIVE=d:"
set "HOMEPATH=\Nithya\.adb-home"
set "LOCALAPPDATA=%ADB_HOME%"
set "APPDATA=%ADB_HOME%"
set "ADB_SERVER_SOCKET=tcp:5037"
set "ADB_BIN=d:\Android\Sdk\platform-tools\adb.exe"
if not exist "%ADB_BIN%" (
  echo adb not found at "%ADB_BIN%"
  exit /b 1
)
"%ADB_BIN%" %*
exit /b %errorlevel%
