@echo off
cd /d "%~dp0"

echo Starting Little Home Discord bot...
call npx pm2 start ecosystem.config.cjs

echo.
echo Current status:
call npx pm2 list

echo.
echo If the bot is "online" above, it's running.
echo You can close this window - the bot keeps running in the background.
pause
