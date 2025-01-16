#!/bin/bash
APP_ID=0
APP_ENV="dev prod"
APP_ENDPOINTS="web=index.html mvk=index.html mobile=index.html"
APP_PATH="testapp"
node app.js "${APP_ID}:${APP_ENV}:${APP_ENDPOINTS}" "${APP_PATH}"