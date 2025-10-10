@echo off
echo =================================
echo Starting Meteor with correct database settings
echo =================================
echo.
echo Using settings.json with ambervisiondb database...
echo.

REM Set environment variables explicitly
REM These should match your settings.json file
set MONGO_URL=YOUR_MONGO_URL_HERE
set MONGO_OPLOG_URL=YOUR_MONGO_OPLOG_URL_HERE

echo Environment variables set:
echo MONGO_URL: ambervisiondb database
echo.

REM Start Meteor with settings
echo Starting Meteor...
meteor run --settings settings.json

pause