@echo off
rem Two-way sync between this folder and GitHub. Saves local work first, so
rem nothing on this computer is ever overwritten by the download.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\sync-github.ps1"
