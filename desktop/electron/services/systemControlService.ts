import { exec } from "child_process";
import path from "path";
import os from "os";
import fs from "fs";

// ---------- Task 6 fix: use EncodedCommand (base64) for ALL PowerShell calls ----------
// This replaces the old -Command "..." approach which broke on scripts containing
// quotes, apostrophes, or multi-line C# here-strings. EncodedCommand accepts
// UTF-16LE base64 and bypasses all shell-quoting issues entirely.
function runPS(script: string, timeoutMs = 15000): Promise<string> {
  return new Promise((resolve, reject) => {
    const encoded = Buffer.from(script, "utf16le").toString("base64");
    exec(
      `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${encoded}`,
      { maxBuffer: 1024 * 1024 * 4, timeout: timeoutMs },
      (error, stdout, stderr) => {
        if (error) reject(stderr || error.message);
        else resolve(stdout.trim());
      }
    );
  });
}

function runCmd(command: string): Promise<void> {
  return new Promise((resolve, reject) => {
    exec(command, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

// ---------- Special folders ----------
const SPECIAL_FOLDERS: Record<string, string> = {
  download: "Downloads",
  downloads: "Downloads",
  document: "Documents",
  documents: "Documents",
  desktop: "Desktop",
  picture: "Pictures",
  pictures: "Pictures",
  music: "Music",
  song: "Music",
  video: "Videos",
  videos: "Videos"
};

export async function openSpecialFolder(name: string): Promise<string> {
  const key = Object.keys(SPECIAL_FOLDERS).find(k => name.toLowerCase().includes(k));
  if (!key) return `I don't know a folder called ${name}.`;

  const folderPath = path.join(os.homedir(), SPECIAL_FOLDERS[key]);
  await runCmd(`explorer "${folderPath}"`);
  return `${SPECIAL_FOLDERS[key]} folder opened.`;
}

// ---------- Volume ----------
export async function setVolume(percent: number): Promise<string> {
  const clamped = Math.max(0, Math.min(100, percent));

  // Uses the Windows Core Audio API via a small inline C# COM wrapper — no extra installs needed.
  // Safe with EncodedCommand: the here-string @' ... '@ has no quoting issues over base64.
  const script = `
Add-Type -TypeDefinition @'
using System.Runtime.InteropServices;
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
  int f(); int g(); int h(); int i();
  int SetMasterVolumeLevelScalar(float fLevel, System.Guid pguidEventContext);
  int j();
  int GetMasterVolumeLevelScalar(out float pfLevel);
}
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice { int Activate(ref System.Guid id, int clsCtx, System.IntPtr activationParams, out IAudioEndpointVolume aev); }
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator { int f(); int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint); }
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorComObject { }
public class AudioVolume {
  public static void SetVolume(float level) {
    var enumerator = new MMDeviceEnumeratorComObject() as IMMDeviceEnumerator;
    IMMDevice dev; enumerator.GetDefaultAudioEndpoint(0, 1, out dev);
    var iid = typeof(IAudioEndpointVolume).GUID;
    IAudioEndpointVolume aev; dev.Activate(ref iid, 23, System.IntPtr.Zero, out aev);
    aev.SetMasterVolumeLevelScalar(level, System.Guid.Empty);
  }
}
'@ -ReferencedAssemblies System.Runtime.InteropServices -PassThru | Out-Null
[AudioVolume]::SetVolume(${clamped / 100})
`;

  try {
    await runPS(script);
    return `Volume set to ${clamped}%.`;
  } catch {
    return `I couldn't change the volume.`;
  }
}

// ---------- Brightness ----------
export async function setBrightness(percent: number): Promise<string> {
  const clamped = Math.max(0, Math.min(100, percent));

  try {
    await runPS(
      `(Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightnessMethods).WmiSetBrightness(1,${clamped})`
    );
    return `Brightness set to ${clamped}%.`;
  } catch {
    return `I couldn't change brightness — your display might not support software brightness control.`;
  }
}

// ---------- Task 5 fix: Wi-Fi auto-detect adapter name ----------
// Instead of hardcoding "Wi-Fi" (which fails on non-English Windows or machines
// with differently-named adapters), we enumerate all Wi-Fi adapters and
// enable/disable them all at once.
export async function toggleWifi(state: "on" | "off"): Promise<string> {
  const action = state === "on" ? "Enable-NetAdapter" : "Disable-NetAdapter";
  // Find all adapters that have a Wi-Fi (802.11) physical medium type (NdisPhysicalMediumNative802_11 = 9)
  const script = `
$adapters = Get-NetAdapter | Where-Object { $_.PhysicalMediaType -eq 'Native 802.11' -or $_.MediaType -eq 'Native 802.11' -or $_.InterfaceDescription -like '*Wi-Fi*' -or $_.InterfaceDescription -like '*Wireless*' -or $_.Name -like '*Wi*Fi*' -or $_.Name -like '*Wireless*' }
if ($adapters) {
  $adapters | ${action} -Confirm:$false
  Write-Output "ok"
} else {
  Write-Output "not_found"
}
`;
  try {
    const result = await runPS(script);
    if (result.includes("not_found")) {
      return `I couldn't find a Wi-Fi adapter. Check your network settings manually.`;
    }
    return `Wi-Fi turned ${state}.`;
  } catch {
    return `I couldn't turn Wi-Fi ${state} — this usually needs admin permission. Try running VSmart as administrator.`;
  }
}

// ---------- Bluetooth ----------
export async function toggleBluetooth(state: "on" | "off"): Promise<string> {
  const action = state === "on" ? "Enable-PnpDevice" : "Disable-PnpDevice";
  const script = `
Get-PnpDevice | Where-Object {$_.FriendlyName -like '*Bluetooth*' -and $_.Class -eq 'Bluetooth'} | ${action} -Confirm:$false
`;
  try {
    await runPS(script);
    return `Bluetooth turned ${state}.`;
  } catch {
    return `I couldn't turn Bluetooth ${state} — this usually needs admin permission. Try running VSmart as administrator.`;
  }
}

// ---------- Screenshot ----------
export async function takeScreenshot(): Promise<string> {
  const folder = path.join(os.homedir(), "Pictures", "VSmart-Screenshots");
  if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });

  // Forward-slash path avoids backslash escaping entirely inside the PS script
  const filePath = path.join(folder, `screenshot-${Date.now()}.png`).replace(/\\/g, "/");

  const script = `
Add-Type -AssemblyName System.Windows.Forms,System.Drawing
$b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
$bmp.Save('${filePath}')
$g.Dispose(); $bmp.Dispose()
`;

  try {
    await runPS(script);
    await runCmd(`explorer "${folder}"`);
    return `Screenshot saved and opened.`;
  } catch {
    return `I couldn't take a screenshot.`;
  }
}

// ---------- Recycle Bin ----------
export async function openRecycleBin(): Promise<string> {
  await runCmd(`explorer shell:RecycleBinFolder`);
  return `Recycle Bin opened.`;
}

// ---------- Notepad + write text ----------
export async function writeNotepad(text: string): Promise<string> {
  const folder = path.join(os.homedir(), "Documents", "VSmart-Notes");
  if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });

  const filePath = path.join(folder, `note-${Date.now()}.txt`);
  fs.writeFileSync(filePath, text, "utf-8");

  await runCmd(`notepad "${filePath}"`);
  return `Written in Notepad.`;
}

// ---------- Task 4: Media playback controls ----------
// Uses the Windows SendInput API via PowerShell to fire virtual media key
// presses — works regardless of which media player is active.
// VK codes: 0xB3 = Play/Pause, 0xB0 = Next, 0xB1 = Prev, 0xAD = Mute,
//           0xAF = Volume Up, 0xAE = Volume Down, 0xB2 = Stop
const MEDIA_KEY_SCRIPT = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class MediaKey {
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, int flags, int extra);
  public static void Press(byte vk) { keybd_event(vk, 0, 0, 0); keybd_event(vk, 0, 2, 0); }
}
'@
`;

function buildMediaScript(vkCode: number): string {
  return `${MEDIA_KEY_SCRIPT}\n[MediaKey]::Press(${vkCode})`;
}

export async function mediaPlayPause(): Promise<string> {
  try {
    await runPS(buildMediaScript(0xB3));
    return `Play/Pause toggled.`;
  } catch {
    return `Couldn't control media playback.`;
  }
}

export async function mediaNext(): Promise<string> {
  try {
    await runPS(buildMediaScript(0xB0));
    return `Skipped to next track.`;
  } catch {
    return `Couldn't skip track.`;
  }
}

export async function mediaPrev(): Promise<string> {
  try {
    await runPS(buildMediaScript(0xB1));
    return `Went back to previous track.`;
  } catch {
    return `Couldn't go back.`;
  }
}

export async function mediaStop(): Promise<string> {
  try {
    await runPS(buildMediaScript(0xB2));
    return `Media stopped.`;
  } catch {
    return `Couldn't stop media.`;
  }
}

export async function mediaMute(): Promise<string> {
  try {
    await runPS(buildMediaScript(0xAD));
    return `Audio muted/unmuted.`;
  } catch {
    return `Couldn't toggle mute.`;
  }
}

// ---------- Task 7: Window management via keyboard shortcuts ----------
// Alt+F4 = close active window, Win+Down = minimize, Win+Up = maximize,
// Win+M = minimize all, Win+D = show desktop
export async function windowAction(action: "minimize" | "maximize" | "close" | "minimize_all" | "show_desktop"): Promise<string> {
  // Use SendKeys via the keyboard — reliable across all Windows apps.
  const KEY_MAP: Record<string, string> = {
    close:        `%{F4}`,             // Alt+F4
    minimize:     `% `,               // Alt+Space then 'n' — actually use WScript approach
    maximize:     `% `,
    minimize_all: `^{ESC}`,           // fallback
    show_desktop: `^{ESC}`,
  };

  // More reliable: use keybd_event with Win key combos for window management
  const WIN_KEY_SCRIPTS: Record<string, string> = {
    minimize: `
${MEDIA_KEY_SCRIPT.replace("MediaKey", "WinKey").replace("keybd_event(byte vk, byte scan, int flags, int extra)", "keybd_event(byte vk, byte scan, int flags, int extra)")}
Add-Type -TypeDefinition @'
using System.Runtime.InteropServices;
public class WinKey2 {
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, int flags, int extra);
}
'@
[WinKey2]::keybd_event(0x5B, 0, 0, 0)   # Win down
[WinKey2]::keybd_event(0x28, 0, 0, 0)   # Down arrow down
[WinKey2]::keybd_event(0x28, 0, 2, 0)   # Down arrow up
[WinKey2]::keybd_event(0x5B, 0, 2, 0)   # Win up
`,
    maximize: `
Add-Type -TypeDefinition @'
using System.Runtime.InteropServices;
public class WinKey3 {
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, int flags, int extra);
}
'@
[WinKey3]::keybd_event(0x5B, 0, 0, 0)
[WinKey3]::keybd_event(0x26, 0, 0, 0)
[WinKey3]::keybd_event(0x26, 0, 2, 0)
[WinKey3]::keybd_event(0x5B, 0, 2, 0)
`,
    close: `
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait("%{F4}")
`,
    minimize_all: `
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait("^{ESC}")
Add-Type -TypeDefinition @'
using System.Runtime.InteropServices;
public class WinKey4 {
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, int flags, int extra);
}
'@
[WinKey4]::keybd_event(0x5B, 0, 0, 0)
[WinKey4]::keybd_event(0x4D, 0, 0, 0)
[WinKey4]::keybd_event(0x4D, 0, 2, 0)
[WinKey4]::keybd_event(0x5B, 0, 2, 0)
`,
    show_desktop: `
Add-Type -TypeDefinition @'
using System.Runtime.InteropServices;
public class WinKey5 {
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, int flags, int extra);
}
'@
[WinKey5]::keybd_event(0x5B, 0, 0, 0)
[WinKey5]::keybd_event(0x44, 0, 0, 0)
[WinKey5]::keybd_event(0x44, 0, 2, 0)
[WinKey5]::keybd_event(0x5B, 0, 2, 0)
`,
  };

  const RESULT_MESSAGES: Record<string, string> = {
    minimize:     `Window minimized.`,
    maximize:     `Window maximized.`,
    close:        `Window closed.`,
    minimize_all: `All windows minimized.`,
    show_desktop: `Desktop shown.`,
  };

  const script = WIN_KEY_SCRIPTS[action];
  if (!script) return `Unknown window action: ${action}`;

  try {
    await runPS(script);
    return RESULT_MESSAGES[action];
  } catch {
    return `Couldn't perform window action: ${action}.`;
  }
}

// ---------- Restart / Shutdown (caller must confirm first) ----------
export async function restartPC(): Promise<string> {
  await runCmd(`shutdown /r /t 5`);
  return `Restarting the PC in 5 seconds.`;
}

export async function shutdownPC(): Promise<string> {
  await runCmd(`shutdown /s /t 5`);
  return `Shutting down the PC in 5 seconds.`;
}

export async function cancelShutdown(): Promise<string> {
  await runCmd(`shutdown /a`);
  return `Cancelled.`;
}
