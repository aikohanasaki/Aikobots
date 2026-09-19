@echo off
pushd %~dp0
set NODE_ENV=production
call npm install --no-audit --no-fund --loglevel=error --no-progress --include=dev
node server.js %*
pause
popd
