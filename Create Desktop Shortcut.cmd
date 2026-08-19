@echo off
rem Creates the "Couple Lab" icon on the desktop. Run this once.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\create-shortcut.ps1"
