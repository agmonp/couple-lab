@echo off
rem Reports which Couple Lab folder is the one in use. Deletes nothing.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\compare-folders.ps1"
