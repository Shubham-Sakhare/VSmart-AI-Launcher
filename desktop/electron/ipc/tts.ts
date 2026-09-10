import { ipcMain } from "electron";
import fs from "fs";
import { synthesizeSpeech, type VoiceGender } from "../services/ttsService.js";

export function registerTtsIPC() {
  // Synthesizes natural speech and returns it as a base64 data URL the
  // renderer can play directly in an <audio> element — avoids exposing a
  // raw filesystem path across the IPC boundary.
  ipcMain.handle(
    "tts:synthesize",
    async (_event, text: string, lang: "en" | "hi", gender: VoiceGender) => {
      const filePath = await synthesizeSpeech(text, lang, gender);
      if (!filePath) return null;

      try {
        const buffer = fs.readFileSync(filePath);
        const base64 = buffer.toString("base64");
        fs.unlink(filePath, () => {}); // best-effort cleanup
        return `data:audio/mpeg;base64,${base64}`;
      } catch (err) {
        console.error("tts:synthesize - failed to read generated audio:", err);
        return null;
      }
    }
  );
}