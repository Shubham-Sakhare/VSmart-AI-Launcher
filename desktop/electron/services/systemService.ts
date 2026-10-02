import {exec} from "child_process";
import {app,dialog} from "electron";
import fs from "fs";
import path from "path";
import {openInSession} from "./browserSessionService.js";

interface WindowsApp{
name:string;
id:string;
icon:string;
path:string;
}

interface LibraryApp extends WindowsApp{
customIcon?:string;
pinned:boolean;
}

/* ================= paths (userData - safe when packaged) ================= */

function userDataFile(name:string):string{
return path.join(app.getPath("userData"),name);
}

const APPS_CACHE_FILE=userDataFile("system-apps-cache.json");
const LIBRARY_FILE=userDataFile("launcher-library-apps.json");

// How long the disk cache stays "fresh". Re-scanning installed apps + icons
// is the heaviest operation in the launcher, so we avoid doing it more than
// this often - it's the main fix for launcher lag / system load.
const CACHE_TTL_MS=12*60*60*1000; // 12 hours

/* ================= in-memory state ================= */

let installedAppsCache:WindowsApp[]|null=null;
let backgroundRefreshInFlight=false;

/* ================= disk cache helpers ================= */

function readAppsCacheFromDisk():{ts:number;apps:WindowsApp[]}|null{
try{
if(!fs.existsSync(APPS_CACHE_FILE))return null;
return JSON.parse(fs.readFileSync(APPS_CACHE_FILE,"utf-8"));
}catch{
return null;
}
}

function writeAppsCacheToDisk(apps:WindowsApp[]){
try{
fs.mkdirSync(path.dirname(APPS_CACHE_FILE),{recursive:true});
fs.writeFileSync(APPS_CACHE_FILE,JSON.stringify({ts:Date.now(),apps}));
}catch{
/* best-effort cache, ignore write failures */
}
}

/* ================= powershell: apps + icons in one pass ================= */

// Enumerates shell:AppsFolder (covers both classic desktop apps and UWP/
// Store apps) and pulls a small 32x32 PNG icon for each, base64-encoded.
// Wrapped so any single app's icon failure never breaks the rest of the list.
const FETCH_SCRIPT=`
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @"
using System;
using System.Windows.Forms;
public class VSmartIconHelper : AxHost {
  public VSmartIconHelper() : base(string.Empty) { }
  public static System.Drawing.Image GetImage(object iPictureDisp) {
    return GetPictureFromIPicture(iPictureDisp);
  }
}
"@ -ReferencedAssemblies System.Windows.Forms, System.Drawing

$shell = New-Object -ComObject Shell.Application
$folder = $shell.Namespace('shell:AppsFolder')
$out = New-Object System.Collections.ArrayList

foreach ($item in $folder.Items()) {
  try {
    $name = $item.Name
    $appId = $folder.GetDetailsOf($item, 0)
    $iconB64 = $null
    try {
      $pic = $item.ExtendedProperty("System.Thumbnail")
      if ($pic) {
        $img = [VSmartIconHelper]::GetImage($pic)
        if ($img) {
          $bmp = New-Object System.Drawing.Bitmap $img, 32, 32
          $ms = New-Object System.IO.MemoryStream
          $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
          $iconB64 = [Convert]::ToBase64String($ms.ToArray())
          $ms.Dispose(); $bmp.Dispose(); $img.Dispose()
        }
      }
    } catch {}
    if ($name -and $appId) {
      [void]$out.Add([PSCustomObject]@{ name = $name; id = $appId; icon = $iconB64 })
    }
  } catch {}
}
$out | ConvertTo-Json -Compress -Depth 3
`;

function runPowerShellAppsWithIcons():Promise<WindowsApp[]>{
return new Promise((resolve)=>{

const encoded=Buffer.from(FETCH_SCRIPT,"utf16le").toString("base64");

exec(
`powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${encoded}`,
{maxBuffer:1024*1024*50,timeout:25000},
(error,stdout)=>{

if(error||!stdout){
resolve([]);
return;
}

try{

const data=JSON.parse(stdout);
const apps=Array.isArray(data)?data:[data];

const list=apps
.filter((a:any)=>a&&a.name&&a.id)
.map((a:any)=>({
name:a.name,
id:a.id,
icon:a.icon?`data:image/png;base64,${a.icon}`:"",
path:""
}))
.filter(
(a:WindowsApp,index:number,self:WindowsApp[])=>
index===self.findIndex(x=>x.id===a.id)
);

resolve(list);

}catch{
resolve([]);
}

}
);

});
}

// Lightweight fallback (no icons) - fast and reliable, used only if the
// icon-enabled fetch above fails or times out on a particular machine.
function runPowerShellStartAppsFallback():Promise<WindowsApp[]>{
return new Promise((resolve)=>{

exec(
`powershell -NoProfile -NonInteractive -Command "Get-StartApps | ConvertTo-Json -Compress"`,
{maxBuffer:1024*1024*20,timeout:10000},
(error,stdout)=>{

if(error||!stdout){
resolve([]);
return;
}

try{

const data=JSON.parse(stdout);
const apps=Array.isArray(data)?data:[data];

const list=apps
.filter((a:any)=>a.Name&&a.AppID)
.map((a:any)=>({name:a.Name,id:a.AppID,icon:"",path:""}))
.filter(
(a:WindowsApp,index:number,self:WindowsApp[])=>
index===self.findIndex(x=>x.id===a.id)
);

resolve(list);

}catch{
resolve([]);
}

}
);

});
}

async function fetchInstalledAppsFresh():Promise<WindowsApp[]>{
const withIcons=await runPowerShellAppsWithIcons();
if(withIcons.length>0)return withIcons;
return await runPowerShellStartAppsFallback();
}

/* ================= public: installed apps (fast, cached) ================= */

// Always resolves immediately from memory/disk cache when available, and
// only refreshes in the background when the cache is stale. This is what
// keeps the launcher smooth - the heavy PowerShell scan almost never blocks
// the UI thread of the renderer.
export function getInstalledApps():Promise<WindowsApp[]>{

if(installedAppsCache){
maybeRefreshInBackground();
return Promise.resolve(installedAppsCache);
}

const disk=readAppsCacheFromDisk();

if(disk&&disk.apps.length>0){
installedAppsCache=disk.apps;
maybeRefreshInBackground();
return Promise.resolve(disk.apps);
}

return fetchInstalledAppsFresh().then(apps=>{
installedAppsCache=apps;
writeAppsCacheToDisk(apps);
return apps;
});

}

function maybeRefreshInBackground(){

if(backgroundRefreshInFlight)return;

const disk=readAppsCacheFromDisk();
const stale=!disk||(Date.now()-disk.ts)>CACHE_TTL_MS;

if(!stale)return;

backgroundRefreshInFlight=true;

fetchInstalledAppsFresh()
.then(apps=>{
if(apps.length>0){
installedAppsCache=apps;
writeAppsCacheToDisk(apps);
}
})
.finally(()=>{
backgroundRefreshInFlight=false;
});

}

export function clearAppsCache(){
installedAppsCache=null;
try{fs.unlinkSync(APPS_CACHE_FILE);}catch{/* cache file may not exist yet — fine to ignore */}
}

export function launchSystemApp(appId:string):Promise<boolean>{

return new Promise((resolve)=>{

exec(
`powershell -NoProfile -Command "Start-Process 'shell:AppsFolder\\${appId}'"`,
(error)=>{

if(error){
resolve(false);
}else{
resolve(true);
}

}

);

});


}

// Manually add an app that the automatic shell:AppsFolder scan missed
// (e.g. a portable .exe not registered with Windows). The user picks a
// file, we store its raw path as the id/path so launchLibraryAppPath can
// start it directly later. Icon starts empty - the existing "Edit icon"
// flow (pickAndSetLibraryIcon) already covers setting a custom one.
export async function pickAndAddCustomApp():Promise<LibraryApp[]>{

const result=await dialog.showOpenDialog({
title:"Choose an application",
filters:[{name:"Applications",extensions:["exe","lnk"]}],
properties:["openFile"]
});

if(result.canceled||!result.filePaths[0]){
return readLibrary();
}

const filePath=result.filePaths[0];
const name=path.basename(filePath).replace(/\.(exe|lnk)$/i,"");
const id=`custom:${filePath}`;

const list=readLibrary();

if(!list.find(a=>a.id===id)){
list.push({
name,
id,
icon:"",
path:filePath,
pinned:false
});
writeLibrary(list);
}

return list;

}

// Launches a manually-added app by its stored file path (as opposed to
// launchSystemApp, which resolves shell:AppsFolder ids for auto-scanned apps).
export function launchLibraryAppPath(filePath:string):Promise<boolean>{
return new Promise((resolve)=>{
exec(`start "" "${filePath.replace(/"/g,"")}"`,(error)=>{
resolve(!error);
});
});
}

/* ================= launcher library: add / remove / pin / edit icon ================= */
// One list is the single source of truth:
//  - the "System icon" panel (next to the V logo) shows every app the user
//    has added here (via Settings -> Add System App)
//  - the taskbar quick row shows only the ones with pinned=true
// Right-click inside the System icon panel: Pin/Unpin, Edit icon, Remove.

function readLibrary():LibraryApp[]{
try{
if(!fs.existsSync(LIBRARY_FILE))return [];
return JSON.parse(fs.readFileSync(LIBRARY_FILE,"utf-8"));
}catch{
return [];
}
}

function writeLibrary(list:LibraryApp[]){
try{
fs.mkdirSync(path.dirname(LIBRARY_FILE),{recursive:true});
fs.writeFileSync(LIBRARY_FILE,JSON.stringify(list));
}catch{
/* best-effort persistence */
}
}

// Full "added by user" list - backs the System icon panel.
export function getLibraryApps():LibraryApp[]{
return readLibrary();
}

// Subset that shows directly on the taskbar - backs the quick row.
export function getPinnedApps():LibraryApp[]{
return readLibrary().filter(a=>a.pinned);
}

// Bulk add from the Settings "Add System App" picker (checkbox multi-select).
export function addLibraryApps(newApps:WindowsApp[]):LibraryApp[]{
const list=readLibrary();

for(const newApp of newApps){
if(!list.find(a=>a.id===newApp.id)){
list.push({
name:newApp.name,
id:newApp.id,
icon:newApp.icon,
path:newApp.path||"",
pinned:false
});
}
}

writeLibrary(list);
return list;
}

// Removes an app from the library entirely (also drops it off the taskbar,
// since the taskbar row is just a filtered view of this same list).
export function removeLibraryApp(id:string):LibraryApp[]{
const list=readLibrary().filter(a=>a.id!==id);
writeLibrary(list);
return list;
}

// Used for drag-to-reorder in the taskbar. Places the given ids first (in
// the order provided), then appends anything not mentioned, preserving its
// original relative order.
export function reorderLibraryApps(orderedIds:string[]):LibraryApp[]{
const list=readLibrary();
const byId=new Map(list.map(a=>[a.id,a]));
const reordered:LibraryApp[]=[];

for(const id of orderedIds){
const item=byId.get(id);
if(item){
reordered.push(item);
byId.delete(id);
}
}

for(const a of list){
if(byId.has(a.id))reordered.push(a);
}

writeLibrary(reordered);
return reordered;
}

// Toggle whether an already-added app also shows on the taskbar quick row.
export function setLibraryAppPinned(id:string,pinned:boolean):LibraryApp[]{
const list=readLibrary().map(a=>a.id===id?{...a,pinned}:a);
writeLibrary(list);
return list;
}

// Opens a native "choose an image" dialog and stores the picked image as the
// custom icon for a library app (small base64 data URL, no extra IPC/file
// wiring needed on the renderer side).
// Generic "choose an image, return it as a data URL" - reusable anywhere an
// icon needs to be customized (system apps, internal launcher apps, etc.)
export async function pickImageAsDataUrl():Promise<string|null>{

const result=await dialog.showOpenDialog({
title:"Choose icon",
filters:[{name:"Images",extensions:["png","jpg","jpeg","ico","webp"]}],
properties:["openFile"]
});

if(result.canceled||!result.filePaths[0]){
return null;
}

try{

const filePath=result.filePaths[0];
const ext=(path.extname(filePath).slice(1)||"png").toLowerCase();
const buf=fs.readFileSync(filePath);
return `data:image/${ext};base64,${buf.toString("base64")}`;

}catch{
return null;
}

}

export async function pickAndSetLibraryIcon(id:string):Promise<LibraryApp[]>{

const dataUrl=await pickImageAsDataUrl();

if(!dataUrl){
return readLibrary();
}

const list=readLibrary().map(a=>a.id===id?{...a,customIcon:dataUrl}:a);
writeLibrary(list);
return list;

}

// Generic "choose an image, get a data URL back" - used for anything that
// isn't part of the library-apps list (e.g. a custom icon for one of the
// launcher's own built-in pages).
export async function pickIconFile():Promise<string|null>{

const result=await dialog.showOpenDialog({
title:"Choose icon",
filters:[{name:"Images",extensions:["png","jpg","jpeg","ico","webp"]}],
properties:["openFile"]
});

if(result.canceled||!result.filePaths[0]){
return null;
}

try{
const filePath=result.filePaths[0];
const ext=(path.extname(filePath).slice(1)||"png").toLowerCase();
const buf=fs.readFileSync(filePath);
return `data:image/${ext};base64,${buf.toString("base64")}`;
}catch{
return null;
}

}


const appMap:Record<string,string>={
chrome:"chrome",
browser:"chrome",
vscode:"code",
"vs code":"code",
"visual studio code":"code",
"v s code":"code",
"code editor":"code",
cde:"code",
// Common Vosk mishearings of "VS Code" observed in practice - narrow,
// exact-word aliases so they don't accidentally swallow unrelated speech.
"b s":"code",
bs:"code",
code:"code",
calculator:"calc",
calc:"calc",
notepad:"notepad",
explorer:"explorer",
file:"explorer",
wordpad:"wordpad",
paint:"mspaint",
"task manager":"taskmgr",
settings:"ms-settings:"
};


const siteMap:Record<string,string>={
youtube:"https://youtube.com",
google:"https://google.com",
gmail:"https://mail.google.com",
facebook:"https://facebook.com",
fb:"https://facebook.com",
instagram:"https://instagram.com",
whatsapp:"https://web.whatsapp.com",
github:"https://github.com",
chatgpt:"https://chat.openai.com"
};


const searchableSites:Record<string,string>={
youtube:"https://www.youtube.com/results?search_query=",
google:"https://www.google.com/search?q="
};


// Navigates the already-open YouTube tab (from openInSession's session
// tracking) to a search results page - used for the "open youtube" ->
// "what do you want to watch?" -> search follow-up flow.
export async function searchOnYoutube(query:string):Promise<string>{
try{
await openInSession(
"youtube",
searchableSites.youtube+encodeURIComponent(query)
);
return "";
}catch{
return "";
}
}

/* ================= Chrome profiles ================= */

export interface ChromeProfile{
name:string;
directory:string;
}

function chromeLocalStatePath():string{
return path.join(
process.env.LOCALAPPDATA||path.join(app.getPath("home"),"AppData","Local"),
"Google","Chrome","User Data","Local State"
);
}

// Reads Chrome's own profile list (same data Chrome's profile picker uses),
// so "open chrome" can offer a real choice when more than one profile
// exists, instead of always opening whichever was used last.
export function getChromeProfiles():ChromeProfile[]{
try{
const raw=fs.readFileSync(chromeLocalStatePath(),"utf-8");
const data=JSON.parse(raw);
const cache=data?.profile?.info_cache;

if(!cache||typeof cache!=="object")return [];

return Object.entries(cache).map(([dir,info]:[string,any])=>({
name:info?.name||info?.shortcut_name||dir,
directory:dir
}));

}catch{
return [];
}
}

export function openChromeProfile(directory:string):void{
const safeDir=directory.replace(/"/g,"");
exec(`start chrome --profile-directory="${safeDir}"`);
}


function runCommand(command:string):Promise<void>{

return new Promise((resolve,reject)=>{

exec(
`start "" "${command}"`,
(error)=>{

if(error)
reject(error);
else
resolve();

}

);

});

}


function matchesWord(text:string,word:string){

return new RegExp(
`\\b${word}\\b`,
"i"
).test(text);

}


function findKey(
text:string,
map:Record<string,string>
){

return Object.keys(map)
.sort((a,b)=>b.length-a.length)
.find(k=>matchesWord(text,k));

}


export async function openApplication(
rawInput:string
):Promise<string>{

const key=rawInput.toLowerCase().trim();


if(!key)
return "";


const appKey=findKey(
key,
appMap
);


if(appKey){

try{

await runCommand(
appMap[appKey]
);

return "";

}catch{

return "";

}

}


const siteKey=findKey(
key,
siteMap
);


if(siteKey){

try{

await openInSession(
siteKey,
siteMap[siteKey]
);

return "";

}catch{

return "";

}

}


// Only attempt the blind "start <key>" fallback when the text plausibly
// looks like a real app name (Windows can resolve any registered App Path
// this way, even ones not in our appMap above). Short fragments like "b s"
// are almost always a misheard/garbled bit of speech, not a real app name -
// attempting them anyway is what causes Windows' own "cannot find" dialog
// to pop up (that popup comes from Windows itself, not something our code
// can suppress once triggered). Skipping it here avoids the popup entirely
// and goes straight to a graceful search fallback instead.
const looksLikeAppName = key.replace(/\s+/g, "").length >= 4;

if (looksLikeAppName) {

try{

await runCommand(key);

return "";

}catch{

try{

await openInSession(
"google",
`https://www.google.com/search?q=${encodeURIComponent(rawInput)}`
);

return "";

}catch{

return "";

}

}

}

try{

await openInSession(
"google",
`https://www.google.com/search?q=${encodeURIComponent(rawInput)}`
);

return "";

}catch{

return "";

}

}