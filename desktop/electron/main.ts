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
// browserIPC removed — Playwright not installed; shell.openExternal() used directly
// import{registerBrowserIPC}from"./ipc/browser.js";
import{registerFileIntelligenceIPC}from"./ipc/fileIntelligence.js";
// schedulerIPC removed — not needed for core voice assistant, reduces startup overhead
// import{registerSchedulerIPC}from"./ipc/scheduler.js";
import{initWhisper}from"./services/whisperService.js";
import{promptLaunchPreferenceIfNeeded}from"./services/launchPreference.js";
import{registerLaunchPrefIPC}from"./ipc/launchPref.js";
// initScheduler removed along with schedulerIPC
// import{initScheduler}from"./services/schedulerService.js";

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

// Content-Security-Policy
// Dev mode: looser policy so Vite HMR, Ollama (localhost:11434), OpenRouter,
//           and Edge TTS (speech.platform.bing.com) all work without errors.
// Prod mode: tight policy — only known origins, no eval.
const DEV_CSP = [
  "default-src 'self' http://localhost:5173 ws://localhost:5173",
  "script-src 'self' http://localhost:5173 'unsafe-eval' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' http://localhost:5173",
  "img-src 'self' data: blob: http://localhost:5173",
  "font-src 'self' data: http://localhost:5173",
  // All outbound API/service connections explicitly listed
  "connect-src 'self' http://localhost:5173 ws://localhost:5173 http://localhost:11434 https://openrouter.ai https://api.duckduckgo.com https://html.duckduckgo.com https://speech.platform.bing.com wss://speech.platform.bing.com",
  "media-src 'self' data: blob:",
  "object-src 'none'",
].join("; ");

const PROD_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' http://localhost:11434 https://openrouter.ai https://api.duckduckgo.com https://html.duckduckgo.com https://speech.platform.bing.com wss://speech.platform.bing.com",
  "media-src 'self' data: blob:",
  "object-src 'none'",
  "base-uri 'self'",
].join("; ");

const csp = app.isPackaged ? PROD_CSP : DEV_CSP;

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
// initScheduler removed — scheduler not needed for core voice assistant
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
// registerBrowserIPC() removed — Playwright dep not installed
registerFileIntelligenceIPC();
// registerSchedulerIPC() removed — reduces startup overhead

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