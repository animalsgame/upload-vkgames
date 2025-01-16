@echo off
set APP_ID=0
set APP_ENV="dev prod"
set APP_ENDPOINTS="web=index.html mvk=index.html mobile=index.html"
set APP_PATH="testapp"
node app.js %APP_ID%:%APP_ENV%:%APP_ENDPOINTS% %APP_PATH%
pause