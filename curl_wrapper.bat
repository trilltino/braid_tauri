@echo off
echo [CURL-WRAPPER] Arguments received: >> C:\temp\curl_log.txt
echo %* >> C:\temp\curl_log.txt
echo --- >> C:\temp\curl_log.txt
C:\Windows\System32\curl.exe %*
