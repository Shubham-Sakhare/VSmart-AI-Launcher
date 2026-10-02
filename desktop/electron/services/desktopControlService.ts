import { exec } from "child_process";

function runPS(script: string, timeoutMs = 8000): Promise<string | null> {
  return new Promise((resolve) => {
    const encoded = Buffer.from(script, "utf16le").toString("base64");
    exec(
      `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${encoded}`,
      { maxBuffer: 1024 * 1024 * 2, timeout: timeoutMs },
      (error, stdout) => {
        if (error || !stdout) {
          resolve(null);
          return;
        }
        resolve(stdout.trim());
      }
    );
  });
}

const MOUSE_TYPE = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class VSmartMouse {
  [DllImport("user32.dll")]
  public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")]
  public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
}
"@ -ErrorAction Stop
`;

/* ================= mouse ================= */

export async function moveMouseTo(x: number, y: number): Promise<boolean> {
  const raw = await runPS(`
try {
${MOUSE_TYPE}
[VSmartMouse]::SetCursorPos(${Math.round(x)}, ${Math.round(y)})
"ok"
} catch {
"fail"
}
`);
  return raw === "ok";
}

export async function clickAt(
  x: number,
  y: number,
  button: "left" | "right" = "left",
  doubleClick = false
): Promise<boolean> {

  const downFlag = button === "right" ? "0x0008" : "0x0002";
  const upFlag = button === "right" ? "0x0010" : "0x0004";

  const clickOnce = `
[VSmartMouse]::mouse_event(${downFlag}, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 30
[VSmartMouse]::mouse_event(${upFlag}, 0, 0, 0, [UIntPtr]::Zero)
`;

  const raw = await runPS(`
try {
${MOUSE_TYPE}
[VSmartMouse]::SetCursorPos(${Math.round(x)}, ${Math.round(y)})
Start-Sleep -Milliseconds 50
${clickOnce}
${doubleClick ? `Start-Sleep -Milliseconds 90\n${clickOnce}` : ""}
"ok"
} catch {
"fail"
}
`);
  return raw === "ok";
}

export async function getCursorPosition(): Promise<{ x: number; y: number } | null> {
  const raw = await runPS(`
try {
Add-Type -AssemblyName System.Windows.Forms
$p = [System.Windows.Forms.Cursor]::Position
[PSCustomObject]@{ x = $p.X; y = $p.Y } | ConvertTo-Json -Compress
} catch {
"null"
}
`);
  if (!raw || raw === "null") return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/* ================= keyboard ================= */

// SendKeys reserved characters need braces around them.
function escapeSendKeysText(text: string): string {
  return text.replace(/([+^%~(){}[\]])/g, "{$1}");
}

const NAMED_KEYS: Record<string, string> = {
  enter: "{ENTER}", return: "{ENTER}", tab: "{TAB}",
  esc: "{ESC}", escape: "{ESC}",
  backspace: "{BACKSPACE}", delete: "{DELETE}", del: "{DELETE}",
  space: " ",
  up: "{UP}", down: "{DOWN}", left: "{LEFT}", right: "{RIGHT}",
  home: "{HOME}", end: "{END}", pageup: "{PGUP}", pagedown: "{PGDN}",
  f1: "{F1}", f2: "{F2}", f3: "{F3}", f4: "{F4}", f5: "{F5}", f6: "{F6}",
  f7: "{F7}", f8: "{F8}", f9: "{F9}", f10: "{F10}", f11: "{F11}", f12: "{F12}",
};

// Turns something like "ctrl+shift+s" or "alt+f4" or "enter" into the
// SendKeys syntax Windows expects ("^+s", "%{F4}", "{ENTER}").
function toSendKeys(combo: string): string {
  const parts = combo.toLowerCase().split("+").map(p => p.trim()).filter(Boolean);
  let modifiers = "";
  let keyPart = "";

  for (const part of parts) {
    if (part === "ctrl" || part === "control") modifiers += "^";
    else if (part === "alt") modifiers += "%";
    else if (part === "shift") modifiers += "+";
    else if (NAMED_KEYS[part]) keyPart = NAMED_KEYS[part];
    else keyPart = escapeSendKeysText(part);
  }

  return modifiers + keyPart;
}

export async function typeText(text: string): Promise<boolean> {
  const escaped = escapeSendKeysText(text).replace(/"/g, "`\"");
  const raw = await runPS(`
try {
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait("${escaped}")
"ok"
} catch {
"fail"
}
`);
  return raw === "ok";
}

export async function pressKeyCombo(combo: string): Promise<boolean> {
  const sendKeysStr = toSendKeys(combo).replace(/"/g, "`\"");
  const raw = await runPS(`
try {
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait("${sendKeysStr}")
"ok"
} catch {
"fail"
}
`);
  return raw === "ok";
}