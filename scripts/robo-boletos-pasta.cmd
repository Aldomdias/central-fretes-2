@echo off
rem Robo de boletos (tarefa agendada do Windows). Log em logs\robo-boletos\.
cd /d "%~dp0.."
"C:\Program Files\nodejs\node.exe" scripts\robo-boletos-pasta.mjs
