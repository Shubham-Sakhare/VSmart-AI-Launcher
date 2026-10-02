import{contextBridge,ipcRenderer}from"electron";

if (process.env.NODE_ENV !== "production") {
  console.log("VSMART PRELOAD LOADED");
}

contextBridge.exposeInMainWorld("vsmart",{

minimize:()=>ipcRenderer.send("window-minimize"),

maximize:()=>ipcRenderer.send("window-maximize"),

close:()=>ipcRenderer.send("window-close"),

onToggleStart:(callback:()=>void)=>{
const handler=()=>callback();
ipcRenderer.on("shortcut:toggle-start",handler);
return()=>ipcRenderer.removeListener("shortcut:toggle-start",handler);
},

saveMemory:(key:string,value:string)=>
ipcRenderer.invoke("memory-save",key,value),

getMemory:(key:string)=>
ipcRenderer.invoke("memory-get",key),

getAllMemory:()=>
ipcRenderer.invoke("memory-all"),

longMemory:{

saveFact:(key:string,value:string)=>
ipcRenderer.invoke("longmemory:saveFact",key,value),

getFact:(key:string)=>
ipcRenderer.invoke("longmemory:getFact",key),

searchFacts:(query:string,topK?:number)=>
ipcRenderer.invoke("longmemory:searchFacts",query,topK),

getAllFacts:()=>
ipcRenderer.invoke("longmemory:getAllFacts"),

deleteFact:(key:string)=>
ipcRenderer.invoke("longmemory:deleteFact",key)

},

openSystem:(appName:string)=>
ipcRenderer.invoke("open-system",appName),

writeCode:(code:string,language?:string,filename?:string)=>
ipcRenderer.invoke("write-code",code,language,filename),

systemControl:(action:string,value?:string|number)=>
ipcRenderer.invoke("system:control",{action,value}),

getMarketFeed:()=>
ipcRenderer.invoke("market:getFeed"),

getAnalysisFeed:()=>
ipcRenderer.invoke("market:getAnalysisFeed"),

getChartAnalysis:(symbol:string,label:string,timeframe?:string)=>
ipcRenderer.invoke("market:getChartAnalysis",symbol,label,timeframe),

/* WINDOWS APPS */
getInstalledApps:()=>
ipcRenderer.invoke("get-installed-apps"),

launchSystemApp:(appId:string)=>
ipcRenderer.invoke("launch-system-app",appId),

vision:{
captureScreen:()=>
ipcRenderer.invoke("vision:captureScreen")
},

project:{
create:(folderName:string,files:{path:string;content:string}[])=>
ipcRenderer.invoke("project:create",folderName,files),

writeFiles:(projectPath:string,files:{path:string;content:string}[])=>
ipcRenderer.invoke("project:writeFiles",projectPath,files),

openInVSCode:(projectPath:string)=>
ipcRenderer.invoke("project:openInVSCode",projectPath),

readFile:(projectPath:string,relativePath:string)=>
ipcRenderer.invoke("project:readFile",projectPath,relativePath),

listFiles:(projectPath:string)=>
ipcRenderer.invoke("project:listFiles",projectPath),

runCommand:(projectPath:string,command:string)=>
ipcRenderer.invoke("project:runCommand",projectPath,command)
},

fileSearch:{
search:(query:string)=>
ipcRenderer.invoke("filesearch:search",query),

openFile:(path:string)=>
ipcRenderer.invoke("filesearch:openFile",path),

openLocation:(path:string)=>
ipcRenderer.invoke("filesearch:openLocation",path)
},

desktopControl:{
move:(x:number,y:number)=>
ipcRenderer.invoke("desktopcontrol:move",x,y),

click:(x:number,y:number,button:"left"|"right",doubleClick:boolean)=>
ipcRenderer.invoke("desktopcontrol:click",x,y,button,doubleClick),

getCursor:()=>
ipcRenderer.invoke("desktopcontrol:getCursor"),

type:(text:string)=>
ipcRenderer.invoke("desktopcontrol:type",text),

pressKey:(combo:string)=>
ipcRenderer.invoke("desktopcontrol:pressKey",combo)
},

launcher:{
getLibraryApps:()=>
ipcRenderer.invoke("launcher:getLibraryApps"),

getPinnedApps:()=>
ipcRenderer.invoke("launcher:getPinnedApps"),

addLibraryApps:(apps:{name:string;id:string;icon:string;path?:string}[])=>
ipcRenderer.invoke("launcher:addLibraryApps",apps),

removeLibraryApp:(id:string)=>
ipcRenderer.invoke("launcher:removeLibraryApp",id),

reorderLibraryApps:(orderedIds:string[])=>
ipcRenderer.invoke("launcher:reorderLibraryApps",orderedIds),

setPinned:(id:string,pinned:boolean)=>
ipcRenderer.invoke("launcher:setPinned",id,pinned),

pickIcon:(id:string)=>
ipcRenderer.invoke("launcher:pickIcon",id),

pickImage:()=>
ipcRenderer.invoke("launcher:pickImage"),

pickAndAddCustomApp:()=>
ipcRenderer.invoke("launcher:pickAndAddCustomApp"),

launchPath:(filePath:string)=>
ipcRenderer.invoke("launcher:launchPath",filePath)
},

system:{
getInfo:()=>
ipcRenderer.invoke("system:getInfo"),

searchYoutube:(query:string)=>
ipcRenderer.invoke("system:searchYoutube",query),

getChromeProfiles:()=>
ipcRenderer.invoke("system:getChromeProfiles"),

openChromeProfile:(directory:string)=>
ipcRenderer.invoke("system:openChromeProfile",directory),

getDesktopItems:(force?:boolean)=>
ipcRenderer.invoke("system:getDesktopItems",force),

getSystemPlaces:()=>
ipcRenderer.invoke("system:getSystemPlaces"),

openDesktopItem:(itemPath:string)=>
ipcRenderer.invoke("system:openDesktopItem",itemPath)
},

voice:{
sendAudioChunk:(chunk:ArrayBuffer)=>
ipcRenderer.send("voice:audio-chunk",chunk),

reset:()=>
ipcRenderer.send("voice:reset"),

/** Batch-mode transcription. Call once VAD detects end of turn.
    Pass lang ("en"/"hi") for a faster, more accurate result vs "auto". */
finalize:(lang?:string)=>
ipcRenderer.invoke("voice:finalize",lang)
},

/** Natural neural TTS (Microsoft Edge Indian voices).
    Returns a base64 audio data URL or null (falls back to offline TTS). */
tts:{
synthesize:(text:string,lang:"en"|"hi",gender:"male"|"female")=>
ipcRenderer.invoke("tts:synthesize",text,lang,gender)
},

apiKey:{
save:(key:string)=>
ipcRenderer.invoke("apikey:save",key),

get:()=>
ipcRenderer.invoke("apikey:get"),

has:()=>
ipcRenderer.invoke("apikey:has"),

clear:()=>
ipcRenderer.invoke("apikey:clear")
},

launchPref:{
get:()=>
ipcRenderer.invoke("launchpref:get"),

set:(enabled:boolean)=>
ipcRenderer.invoke("launchpref:set",enabled)
}

});
