@echo off
setlocal
if defined CLAUDE_PLUGIN_ROOT (
  set "PLUGIN_ROOT=%CLAUDE_PLUGIN_ROOT%"
) else (
  set "PLUGIN_ROOT=%~dp0.."
)
node "%PLUGIN_ROOT%\dist\src\cli.js" %*
