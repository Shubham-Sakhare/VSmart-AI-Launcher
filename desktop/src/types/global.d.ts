export {};

declare global{
interface Window{
vsmart:{
minimize:()=>void;
maximize:()=>void;
close:()=>void;

onToggleStart:(callback:()=>void)=>()=>void;

openSystem:(appName:string)=>Promise<string>;

saveMemory:(key:string,value:string)=>Promise<any>;
getMemory:(key:string)=>Promise<any>;
getAllMemory:()=>Promise<any>;

longMemory:{
saveFact:(key:string,value:string)=>Promise<boolean>;
getFact:(key:string)=>Promise<string|null>;
searchFacts:(query:string,topK?:number)=>Promise<{
key:string;
value:string;
score:number;
}[]>;
getAllFacts:()=>Promise<{
key:string;
value:string;
created_at:string;
updated_at:string;
}[]>;
deleteFact:(key:string)=>Promise<boolean>;
};

writeCode:(code:string,language?:string,filename?:string)=>Promise<string>;

systemControl:(action:string,value?:string|number)=>Promise<string>;

getMarketFeed:()=>Promise<{
symbol:string;
label:string;
price:string;
changePercent:number;
up:boolean;
}[]>;

getAnalysisFeed:()=>Promise<{
symbol:string;
label:string;
price:string;
changePercent:number;
up:boolean;
}[]>;

getChartAnalysis:(symbol:string,label:string,timeframe?:string)=>Promise<any>;

getInstalledApps:()=>Promise<{
name:string;
id:string;
icon:string;
}[]>;

launchSystemApp:(appId:string)=>Promise<boolean>;

vision:{
captureScreen:()=>Promise<string|null>;
};

project:{
create:(folderName:string,files:{path:string;content:string}[])=>Promise<{
ok:boolean;
projectPath:string|null;
}>;
writeFiles:(projectPath:string,files:{path:string;content:string}[])=>Promise<boolean>;
openInVSCode:(projectPath:string)=>Promise<boolean>;
readFile:(projectPath:string,relativePath:string)=>Promise<string|null>;
listFiles:(projectPath:string)=>Promise<string[]>;
runCommand:(projectPath:string,command:string)=>Promise<{
stdout:string;
stderr:string;
exitCode:number|null;
}>;
};

fileSearch:{
search:(query:string)=>Promise<{
name:string;
path:string;
modified:string|null;
}[]>;
openFile:(path:string)=>Promise<boolean>;
openLocation:(path:string)=>Promise<boolean>;
};

desktopControl:{
move:(x:number,y:number)=>Promise<boolean>;
click:(x:number,y:number,button:"left"|"right",doubleClick:boolean)=>Promise<boolean>;
getCursor:()=>Promise<{x:number;y:number}|null>;
type:(text:string)=>Promise<boolean>;
pressKey:(combo:string)=>Promise<boolean>;
};

launcher:{
getLibraryApps:()=>Promise<{
name:string;
id:string;
icon:string;
customIcon?:string;
pinned:boolean;
}[]>;

getPinnedApps:()=>Promise<{
name:string;
id:string;
icon:string;
customIcon?:string;
pinned:boolean;
}[]>;

addLibraryApps:(apps:{name:string;id:string;icon:string;path?:string}[])=>Promise<{
name:string;
id:string;
icon:string;
customIcon?:string;
pinned:boolean;
}[]>;

removeLibraryApp:(id:string)=>Promise<{
name:string;
id:string;
icon:string;
customIcon?:string;
pinned:boolean;
}[]>;

reorderLibraryApps:(orderedIds:string[])=>Promise<{
name:string;
id:string;
icon:string;
customIcon?:string;
pinned:boolean;
}[]>;

setPinned:(id:string,pinned:boolean)=>Promise<{
name:string;
id:string;
icon:string;
customIcon?:string;
pinned:boolean;
}[]>;

pickIcon:(id:string)=>Promise<{
name:string;
id:string;
icon:string;
customIcon?:string;
pinned:boolean;
}[]>;

pickImage:()=>Promise<string|null>;

pickAndAddCustomApp:()=>Promise<{
name:string;
id:string;
icon:string;
customIcon?:string;
pinned:boolean;
}[]>;

launchPath:(filePath:string)=>Promise<boolean>;
};


system:{
getInfo:()=>Promise<{
cpu:number;
ram:number;
storage:number;
}>;
searchYoutube:(query:string)=>Promise<string>;
getChromeProfiles:()=>Promise<{name:string;directory:string}[]>;
openChromeProfile:(directory:string)=>Promise<boolean>;
getDesktopItems:(force?:boolean)=>Promise<{
name:string;
displayName:string;
path:string;
type:"folder"|"file"|"shortcut"|"app"|"place";
extension:string|null;
size:number|null;
modified:string|null;
placeId?:string;
}[]>;
getSystemPlaces:()=>Promise<{
name:string;
displayName:string;
path:string;
type:"folder"|"file"|"shortcut"|"app"|"place";
extension:string|null;
size:number|null;
modified:string|null;
placeId?:string;
}[]>;
openDesktopItem:(itemPath:string)=>Promise<boolean>;
};

voice:{
sendAudioChunk:(chunk:ArrayBuffer)=>void;
reset:()=>void;
finalize:(lang?:string)=>Promise<string>;
onPartialResult:(callback:(text:string)=>void)=>void;
onFinalResult:(callback:(text:string)=>void)=>void;
};

/** Natural neural text-to-speech (Microsoft Edge voices). Returns a base64
    audio data URL, or null if synthesis failed (e.g. offline) — callers
    should fall back to the browser's offline speechSynthesis in that case. */
tts:{
synthesize:(text:string,lang:"en"|"hi",gender:"male"|"female")=>Promise<string|null>;
};

apiKey:{
save:(key:string)=>Promise<boolean>;
get:()=>Promise<string|null>;
has:()=>Promise<boolean>;
clear:()=>Promise<boolean>;
};

launchPref:{
get:()=>Promise<boolean>;
set:(enabled:boolean)=>Promise<boolean>;
};

};
}
}