import { ipcMain } from "electron";
import { processAudioChunk, resetRecognizer, finalizeTranscription } from "../services/whisperService.js";

export function registerVoiceIPC() {

  // Audio chunks just accumulate now — Whisper is batch-based, so there
  // are no per-chunk partial/final events like Vosk gave us.
  ipcMain.on("voice:audio-chunk", (_event, chunk: ArrayBuffer) => {
    processAudioChunk(Buffer.from(chunk));
  });

  ipcMain.on("voice:reset", () => {
    resetRecognizer();
  });

  // Called once the renderer's own VAD/silence-detection decides the turn
  // is over. Runs whisper.cpp on everything buffered since the last reset
  // and returns the transcript directly (no event round-trip needed).
  // `lang` ("en"/"hi") is an explicit hint for Whisper's language flag —
  // auto-detect is unreliable on short command-length clips.
  ipcMain.handle("voice:finalize", async (_event, lang?: string) => {
    return await finalizeTranscription(lang);
  });

}