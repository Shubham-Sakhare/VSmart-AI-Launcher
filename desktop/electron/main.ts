import{registerApiKeyIPC}from"./ipc/apiKey.js";
import{app,BrowserWindow,ipcMain,session,globalShortcut}from"electron";
import{createMainWindow}from"./windows/mainWindow.js";
import{registerWindowIPC}from"./ipc/window.js";
import{registerMemoryIPC}from"./ipc/memory.js";
import{openApplication}from"./services/systemService.js";
import{writeAndOpenCode}from"./services/codeWriterService.js";
import{registerSystemIPC}from"./ipc/system.js";
import{registerVoiceIPC}from"./ipc/voice.js";
import{registerTtsIPC}from"./ipc/tts.js";
import{registerSystemControlIPC}from"./ipc/systemControl.js";
import{registerMarketIPC}from"./ipc/market.js";
import{registerLauncherIPC}from"./ipc/launcher.js";
import{registerVisionIPC}from"./ipc/vision.js";
import{registerFileSearchIPC}from"./ipc/fileSearch.js";
import{registerDesktopControlIPC}from"./ipc/desktopControl.js";
import{registerProjectIPC}from"./ipc/project.js";
import{initWhisper}from"./services/whisperService.js";
import{promptLaunchPreferenceIfNeeded}from"./services/launchPreference.js";
import{registerLaunchPrefIPC}from"./ipc/launchPref.js";

let mainWindow:BrowserWindow|null=null;

app.whenReady().then(()=>{

session.defaultSession.setPermissionRequestHandler(
(_webContents,permission,callback)=>{
if(permission==="media"){
callback(true);
}else{
callback(false);
}
}
);

// Content-Security-Policy - silences Electron's "Insecure CSP" dev warning
// and is genuinely tighter security for the packaged app. Dev mode needs a
// slightly looser policy (Vite's dev server + HMR websocket); production
// gets a strict one with no remote script/style sources at all.
const csp=app.isPackaged
?"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self' https://openrouter.ai; media-src 'self'; object-src 'none'; base-uri 'self';"
:"default-src 'self' http://localhost:5173 ws://localhost:5173; script-src 'self' http://localhost:5173 'unsafe-eval' 'unsafe-inline'; style-src 'self' 'unsafe-inline' http://localhost:5173; img-src 'self' data: http://localhost:5173; font-src 'self' data:; connect-src 'self' http://localhost:5173 ws://localhost:5173 https://openrouter.ai; media-src 'self'; object-src 'none';";

session.defaultSession.webRequest.onHeadersReceived((details,callback)=>{
callback({
responseHeaders:{
...details.responseHeaders,
"Content-Security-Policy":[csp]
}
});
});

// Voice IPC handlers are registered immediately so the renderer can talk to
// them right away, but the actual Whisper model loads AFTER the window
// is created and shown, via setImmediate. This means the window appears
// instantly instead of waiting for the model to load first. Voice
// features simply become active a moment later - no behavior is removed.
registerVoiceIPC();
registerTtsIPC();
registerApiKeyIPC();
registerLaunchPrefIPC();
mainWindow=createMainWindow();
promptLaunchPreferenceIfNeeded(mainWindow);

setImmediate(()=>{
initWhisper();
});

registerWindowIPC(()=>mainWindow);
registerMemoryIPC();
registerSystemIPC();
registerSystemControlIPC();
registerMarketIPC();
registerLauncherIPC();
registerVisionIPC();
registerFileSearchIPC();
registerDesktopControlIPC();
registerProjectIPC();

ipcMain.handle(
"open-system",
async(_,appName:string)=>{
return await openApplication(appName);
}
);

ipcMain.handle(
"write-code",
async(_,code:string,language?:string,filename?:string)=>{
return await writeAndOpenCode(code,language,filename);
}
);

app.on("activate",()=>{
if(BrowserWindow.getAllWindows().length===0){
mainWindow=createMainWindow();
}
});

// Alt+Space toggles the V-logo "VSmart Apps" launcher panel from anywhere,
// even when the app isn't focused - works the same way PowerToys Run /
// most third-party launchers bind their hotkey.
globalShortcut.register("Alt+Space",()=>{
if(mainWindow){
if(!mainWindow.isVisible())mainWindow.show();
if(mainWindow.isMinimized())mainWindow.restore();
mainWindow.focus();
mainWindow.webContents.send("shortcut:toggle-start");
}
});

app.on("will-quit",()=>{
globalShortcut.unregisterAll();
});

});

app.on("window-all-closed",()=>{
if(process.platform!=="darwin"){
app.quit();
}
});