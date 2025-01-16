const fs = require('fs');
const stream = require('stream');
const tls = require('tls');
const urlParser = require('url');
const pathv = require("path");
const exec = require('child_process').exec;
const readline = require('readline');
const magicData = fs.existsSync('magic.js') ? require('./magic') : null;

const appsFolder = 'builds';
const openBrowserURL = true;
const tokenFileName = 'token.txt';
const maxZipSizeMB = 300;
const zipWindowsFolder = '';//'C:\\Program Files\\7-Zip';

const CodeEventResult = {SUCCESS:200, DEPLOY:201, SKIP:202, PUSH:203, PUSH_APPROVED:204, CONFIRM_MESSAGE:205};

const cfgApiVK = {apiHost:'https://api.vk.com/method', oauthHost:'https://oauth.vk.com', appid:6670517, apiVersion:'5.131', clientVersion:2, env:{dev:1, prod:2}, endpoints:{web:1, mvk:1, mobile:1}, platformsArr:[{name:'vk.com', arr:['vk_app_desktop_dev_url', 'iframe_secure_url']}, {name:'iOS & Android', arr:['vk_app_dev_url', 'm_iframe_secure_url']}, {name:'m.vk.com', arr:['vk_mini_app_mvk_dev_url', 'vk_mini_app_mvk_url']}]};

function log(){
var date = new Date();
var timeArr = [date.getHours(), date.getMinutes(), date.getSeconds()].map(v=>{return v<10 ? '0'+v : v});
console.log(...[timeArr.join(':'), ...arguments]);
}

function error(s){
log(s);
process.exit(1);
}

async function sleep(v){
return new Promise(resolve=>{setTimeout(resolve,v)});
}

function openURL(url){
var pl = process.platform;
var start = (pl=='darwin' ? 'open' : pl=='win32' ? 'start' : 'xdg-open');
if(pl=='win32')url = url.split('&').join('^&');
else url = '"'+url+'"';
exec(start+' '+url);
}

function getFileSize(path){
try{
return fs.statSync(path).size;
}catch(e){
}
return -1;
}

function isDir(path){
try{
return fs.lstatSync(path).isDirectory();
}catch(e){
}
return false;
}

async function prompt(msg){
var rl = readline.createInterface({input:process.stdin, output:process.stdout});
return new Promise(resolve=>{
rl.question(msg+' ',res=>{
rl.close();
resolve(res);
});
});
}

function parseHttpHeader(s, obj){
if(!obj.headers)obj.headers = {};
var spl = s.split('\r\n');
var first = spl.shift().split(' ');
obj.status = parseInt(first[1]) || 0;
for (var i = 0; i < spl.length; i++) {
var arr = spl[i].split(': ');
obj.headers[arr[0]] = arr[1];
}
}

async function httpsClient(host, packets, props){
if(!props)props = {};

function cbEmpty(error){}

async function writeFileStream(file, client, cb){
return new Promise(resolve=>{
file.on('data',data=>{client.write(data, cb)}).on('end',()=>{resolve(true)});
});
}

return new Promise(resolve=>{
//var tlsProps = {rejectUnauthorized:false};
var tlsProps = {};
var bufHeader = Buffer.alloc(0);
var chunks = [];
var isErrors = false;
var result = {};
var client = tls.connect(443, host, tlsProps, async()=>{
if(packets){
for (var i = 0; i < packets.length; i++) {
var packet = packets[i];
if(packet instanceof stream.Readable)await writeFileStream(packet, client, cbEmpty);
else client.write(packet, cbEmpty);
}
}
});

client.on('error', (e)=>{
if(!isErrors){
isErrors=true;
resolve(null);
}
//console.error(e);
});

client.on('data', (data)=>{
if(!result.headers){
bufHeader = Buffer.concat([bufHeader,data]);
var p1 = bufHeader.indexOf('\r\n\r\n');
if(p1>-1){
parseHttpHeader(''+bufHeader.subarray(0,p1), result);
chunks.push(bufHeader.subarray(p1+4));
}
}else chunks.push(data);
});

client.on('close', ()=>{
if(chunks.length>0){
result.data = ''+Buffer.concat(chunks);
if(result.headers){
var ct = result.headers['Content-Type'];
if(ct && ct.indexOf('application/json')>-1){
try{
result.data = JSON.parse(result.data);
}catch(e){
result.data = null;
}
}
}
}
resolve(result);
});

});
}

async function request(url, method, params){
if(!method)method = 'GET';
var urlObj = urlParser.parse(url);
var host = urlObj.hostname;
var postFields = [];
var filesList = [];
var contentType = null;
var contentLength = 0;
var payload = '';
var isMultipart = false;
var boundary = null;

if(params){
if(method!='GET'){
contentType = 'application/x-www-form-urlencoded';

for (var n in params){
var value = params[n];
if(value && typeof value=='object'){
if(value.data){
isMultipart=true;
value.name=n;
value.isMultipart=true;
filesList.push(value);
}
}
}

if(isMultipart){
var boundaryID = '';
var boundaryLen = 24;
while(boundaryLen--)boundaryID += String.fromCharCode(97+Math.round(25*Math.random()));
boundary = {id:boundaryID, end:'--'+boundaryID+'--\r\n'};

contentType = 'multipart/form-data; boundary='+boundary.id;

for (var n in params){
var value = params[n];
var s = '--'+boundary.id+'\r\n';
if(value && value.isMultipart){
var fileSize = (value.data instanceof stream.Readable) ? getFileSize(value.data.path) : value.data.length;
s +='Content-Disposition: form-data; name="'+value.name+'"; filename="'+(value.filename||value.name)+'"\r\nContent-Type: '+(value.contentType||'application/octet-stream')+'\r\n\r\n';
contentLength += s.length+fileSize+2;
value.str = s;
}else{
s += 'Content-Disposition: form-data; name="'+n+'"\r\n\r\n'+value+'\r\n';
payload += s;
}
}

}else{
for (var n in params)postFields.push(encodeURIComponent(n)+'='+encodeURIComponent(params[n]));
payload += postFields.join('&');
}
}
}

contentLength += Buffer.from(payload).length;
if(boundary)contentLength += boundary.end.length;
var headersStr = 'Host: '+host+'\r\nConnection: close';
if(contentType)headersStr += '\r\nContent-Type: '+contentType+'\r\nContent-Length: '+contentLength;

var packets=[method+' '+urlObj.path+' HTTP/1.0\r\n'+headersStr+'\r\n\r\n', payload];
if(filesList.length>0){
for (var i = 0; i < filesList.length; i++) {
var el = filesList[i];
packets.push(el.str, el.data, '\r\n');
}
}
if(boundary)packets.push(boundary.end);
return await httpsClient(host, packets);
}


async function execSync(s, isTest){
return new Promise((resolve, reject)=>{
exec(s,(error, stdout, stderr)=>{
if(error){
resolve(false);
return;
}
if(!isTest && stdout)log(stdout);
resolve(true);
});
});
}

async function findZipProgram(){
var slash = '/';
var platform = process.platform;
if(platform=='win32')slash = '\\';
var progList = [
{name:'7z', path:'7-Zip', args:['a', ':result', ':source'+slash+'*']},
{name:'WinRAR', path:'WinRar', args:['a', '-r', '-ep1', '-ibck', '-afzip', ':result', ':source'+slash+'']}
];

if(platform!='win32')progList.push({name:'zip', cmd:'cd :source && zip -r $OLDPWD/:result .', args:[]});

if(platform=='win32'){
if(zipWindowsFolder){
for (var i = 0; i < progList.length; i++) {
var prog = progList[i];
var fullPath=[zipWindowsFolder, prog.name+'.exe'].join(slash);
if(fs.existsSync(fullPath))return {path:fullPath, prog:prog};
}
}

var folders = [process.env.PROGRAMFILES];
var nm = folders[0].split(slash).pop();
if(nm.indexOf(' (x86)')==-1)folders.push(folders[0]+' (x86)');
else folders.push(folders[0].replace(' (x86)',''));

for (var i = 0; i < folders.length; i++) {
var folder = folders[i];
for (var k = 0; k < progList.length; k++) {
var prog = progList[k];
var fullPath=[folder, prog.path, prog.name+'.exe'].join(slash);
if(fs.existsSync(fullPath))return {path:fullPath, prog:prog};
}
}
return null;
}

for (var k = 0; k < progList.length; k++) {
var prog = progList[k];
var cmd = prog.name;
if(cmd=='zip')cmd+=' --help';
var res = await execSync(cmd,true);
if(res)return {path:prog.name, prog:prog};
}

return null;
}

async function createZip(app, src, dst){
if(app && src && dst){
if(fs.existsSync(dst))fs.unlinkSync(dst);
var argsStr = app.prog.args.join(' ');
if(app.prog.cmd)argsStr = app.prog.cmd;
argsStr = argsStr.replace(':source', '"'+src+'"').replace(':result', '"'+dst+'"');
var path = (process.platform=='win32') ? '"'+app.path+'"' : app.path;
var cmd = (app.prog.cmd) ? argsStr : path+' '+argsStr;
var res = await execSync(cmd);
if(!res)return res;
await sleep(30);
return fs.existsSync(dst);
}
}

async function api(token, method, props){
if(!props)props = {};
props.v = cfgApiVK.apiVersion;
props.cli_version = cfgApiVK.clientVersion;
props.access_token = token;
var res = await request(cfgApiVK.apiHost+'/'+method, 'POST', props);
var response = res.data;
if(response && 'response' in response)response = response.response;
if(response && response.error)log('ошибка от api', JSON.stringify(response));
return response;
}

async function getUploadInfo(bundleObj){
if(bundleObj){
var appid = bundleObj.app_id;
var token = null;
var isWrite = true;
if(fs.existsSync(tokenFileName)){
token = ''+fs.readFileSync(tokenFileName);
isWrite = false;
}

if(!token){
var url1 = cfgApiVK.oauthHost+'/get_auth_code?scope=offline&client_id='+cfgApiVK.appid+'&mini_app_id='+appid;

log('Запрос на получение токена');

var res = await request(url1);
if(res.data){
if(res.data.error)error(JSON.stringify(res.data));
if(res.data.auth_code){
var url2 = cfgApiVK.oauthHost+'/code_auth?stage=check&code='+res.data.auth_code+'&revoke=1';
var url3 = cfgApiVK.oauthHost+'/code_auth_token?device_id='+res.data.device_id+'&client_id='+cfgApiVK.appid+'&mini_app_id='+appid;

if(openBrowserURL){
log('Ссылка откроется в браузере, подтвердите авторизацию.');
console.log(url2);
await sleep(2000);
openURL(url2);
}else{
log('Ссылку ниже нужно открыть, и подтвердить авторизацию.');
console.log(url2);
}

var tryCount = 15;
while(tryCount--){
var res = await request(url3);
if(res.status==200){
if(res.data)token = res.data.access_token;
//console.log('ok',res.data,res.status);
break;
}
await sleep(3000);
}

//await sleep(6000);
}
}
}

if(token){
if(isWrite){
log('токен получен!');
//log('ваш токен', token);
try{
fs.writeFileSync(tokenFileName, ''+token);
}catch(e){
log('Не удалось сохранить токен');
}
}

var apiResult = await api(token, 'apps.getBundleUploadServer', bundleObj);

if(apiResult && apiResult.error && apiResult.error.error_code==5){
try{
fs.unlinkSync(tokenFileName);
await sleep(1000);
return await getUploadInfo(bundleObj);
}catch(e){
error('Не удалось удалить токен');
}
}

if(apiResult && apiResult.upload_url)return {token:token, upload_url:apiResult.upload_url};
}else{
error('Не удалось получить токен');
}

}
return null;
}

async function checkEvents(o, props){
if(o){
while(true){
var url = o.base_url+'?act=a_check&key='+o.key+'&ts='+o.ts+'&id='+o.app_id+'&wait=5';
var res = await request(url);
var data = res.data;
if(data && typeof data=='object'){
if('ts' in data)o.ts=data.ts;
if(data.events){
for (var i = 0; i < data.events.length; i++) {
var event = data.events[i].data;

if(event.type=='error'){
error('event error: '+JSON.stringify(event));
}

//log('event', JSON.stringify(event));

if(event.type=='success'){

if(event.code==CodeEventResult.SUCCESS){
log('Публикация началась!');
}else if(event.code==CodeEventResult.CONFIRM_MESSAGE){
var codeStr = null;
if(magicData && magicData.isInit)codeStr = await magicData.getCode();
while(true){
if(!codeStr)codeStr = await prompt('Введите код подтверждения:');
if(codeStr){
var res2 = await api(o.token, 'apps.confirmDeploy', {app_id:o.app_id,version:o.version,code:codeStr});
if(!res2 || res2.error){
codeStr = null;
log('Код не принят, возможно введён неверный код');
}else{
log('Код принят сервером, ждём остальные события.');
break;
}
}
}

}else if(event.code==CodeEventResult.PUSH){
log('Требуется подтверждение через push');
}else if(event.code==CodeEventResult.PUSH_APPROVED){
log('Подтверждение кода выполнено!');
}else if(event.code==CodeEventResult.SKIP){
var env = parseInt(event.message.environment);
if(env==cfgApiVK.env.dev)props.dev = true;
else if(env==cfgApiVK.env.prod)props.prod = true;
}else if(event.code==CodeEventResult.DEPLOY){
var urlsUpdArr=[];
var s = '';
var envType = 0;

if(!props.noFirst){
var date = new Date();
date.setTime(o.version*1000);
var dtArr = [date.getDate(), date.getMonth()+1, date.getFullYear()].map(v=>{return v<10 ? '0'+v : v});
var timeArr = [date.getHours(), date.getMinutes(), date.getSeconds()].map(v=>{return v<10 ? '0'+v : v});
var dateStr = [dtArr.join('.'), timeArr.join(':')].join(' ');

s += '########## version '+o.version+' '+dateStr+' ##########\r\n';
props.noFirst = true;
}

if(event.message.is_production && !props.prod){
s += 'PROD:\r\n';
props.prod = true;
envType = cfgApiVK.env.prod;
log('URL для prod обновлены!');
}

if(!event.message.is_production && !props.dev){
s += 'DEV:\r\n';
props.dev = true;
envType = cfgApiVK.env.dev;
log('URL для dev обновлены!');
}

var urls = (event.message && event.message.urls) ? Object.keys(event.message.urls) : null;
if (urls && urls.length>0){
for (var k = 0; k < urls.length; k++) {
var el = urls[k];
var nm = null;
for (var j = 0; j < cfgApiVK.platformsArr.length; j++) {
var pl = cfgApiVK.platformsArr[j];
if(pl.arr.includes(el)){
nm = pl.name;
break;
}
}
if(!nm)continue;
var urlV = event.message.urls[el];
urlsUpdArr.push(nm+' -> '+urlV);
console.log(nm+' -> '+urlV);
}
}

if(envType>0){
if(urlsUpdArr.length>0)s += urlsUpdArr.join('\r\n');
try{
fs.appendFileSync(appsFolder+'/history_app'+o.app_id+'.txt', s+'\r\n\r\n');
}catch(e){
log('Не удалось записать app'+o.app_id+' в историю');
}
}

}

}
}
}
//console.log(JSON.stringify(data));
}
if(props.dev && props.prod)return true;
await sleep(1000);
}
}
return false;
}

async function init(){
var exitCode = await main(process.argv.slice(2));
if(typeof exitCode!='number')exitCode = 0;
log('exit code',exitCode);
process.exit(exitCode);
}

async function main(args){
var fields = ['appid','env','endpoints'];
var paramsObj = {};

if(args && args.length>0){
var paramsArr = args[0].split(':');
for (var i = 0; i < paramsArr.length; i++) {
if(i>=fields.length)break;
var key = fields[i];
var value = paramsArr[i];
if(!paramsObj[key])paramsObj[key] = {};
var spl = value.split(' ');
if(spl.length==1 && spl[0].indexOf('=')==-1)paramsObj[key] = spl[0];
else{
for (var k = 0; k < spl.length; k++){
var spl2 = spl[k].split('=');
paramsObj[key][spl2[0]] = (spl2.length>1) ? spl2[1] : true;
}
}
}
}

var appPath = pathv.resolve(''+args[1]);
var appid = parseInt(paramsObj.appid) || 0;
var isZipFile = false;

if(appid<=0){
var s2 = await prompt('Введите ID приложения:');
if(s2)appid = parseInt(s2) || 0;
}

if(appid<=0)error('Некорректный ID приложения');

if(!isDir(appPath)){
var fileName=appPath.split('.').pop();
if(fileName=='zip'){
isZipFile = true;
}else{
error('Папка приложения не найдена');
}
}

var bundleObj = {app_id:appid, environment:0, update_prod:0, update_dev:0};

if(paramsObj.env){
if(typeof paramsObj.env=='string'){
var curEnv = paramsObj.env;
paramsObj.env={};
paramsObj.env[curEnv] = true;
}
for(var n in paramsObj.env){
var v = cfgApiVK.env[n];
if(v){
bundleObj.environment |= v;
bundleObj['update_'+n] = 1;
}
}
}

if(bundleObj.environment==0)error('Не указан dev или prod');

var endpointsResArr = [];

if(paramsObj.endpoints){
for(var n in paramsObj.endpoints){
var fileName = paramsObj.endpoints[n];
var v = cfgApiVK.endpoints[n];
if(v){
var path = appPath+'/'+fileName;
if(!isZipFile && !fs.existsSync(path))error('Не найден файл "'+fileName+'" для платформы '+n);
endpointsResArr.push(n+'='+fileName);
bundleObj['endpoint_'+n] = fileName;
}
}
}

if(endpointsResArr.length==0)error('Не указаны платформы для публикации, варианты ['+Object.keys(cfgApiVK.endpoints).join(' ')+']');

log('Выбраны платформы: '+endpointsResArr.join(' '));

//log(bundleObj);

var uploadInfo = await getUploadInfo(bundleObj);
if(uploadInfo && uploadInfo.upload_url){
//log('info',uploadInfo);
}else{
error('Не найден url для загрузки zip архива');
}

var token = uploadInfo.token;
var buildPath = appsFolder;
if(!fs.existsSync(buildPath))fs.mkdirSync(buildPath);
var zipFile = buildPath+'/app'+appid+'.zip';
if(isZipFile){
zipFile = appPath;
}else{
var prog = await findZipProgram();
if(!prog)error('Не найдена программа для создания zip архивов');
log('Выбран архиватор '+prog.path);
log('Идёт создание zip архива', zipFile);
await createZip(prog, appPath, zipFile);
}

var fileSize = getFileSize(zipFile);
if(fileSize<0)error('zip архив с приложением не найден');
if(fileSize>1024*1024*maxZipSizeMB)error('Максимальный размер zip архива '+maxZipFileSizeMB+' мб');

if(magicData && magicData.init)await magicData.init({request:request});

log('Идёт отправка zip архива...');
var res = await request(uploadInfo.upload_url, 'POST', {file:{filename:'build.zip',data:fs.createReadStream(zipFile), contentType:'application/zip'}});
//log('Результат отправки', (typeof res.data=='object') ? JSON.stringify(res.data) : res.data);
if(res.data && typeof res.data=='object' && 'version' in res.data){
var version = res.data.version;
log('Версия: '+version);

log('Подписываемся на события...');
var res2 = await api(token, 'apps.subscribeToHostingQueue', {app_id:appid,version:version});
if(!res2)res2 = {};
if(!res2.base_url || !res2.key || !res2.ts || !res2.app_id){
error('Не удалось подписаться на события '+JSON.stringify(res2));
}
res2.token = token;
res2.version = version;
log('Ждём события...');

var obj = {};
await checkEvents(res2, obj);
if(obj.dev && obj.prod){
log('Публикация завершена!');
await sleep(500);
return 0;
}

return 1;
}else{
error('zip архив не принят сервером, что-то пошло не так '+((res.data && typeof res.data=='object') ? JSON.stringify(res.data) : res.data));
}
return 0;
}

init();