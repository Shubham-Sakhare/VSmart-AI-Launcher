import path from "path";
import fs from "fs";
import os from "os";
import { execFile } from "child_process";
import { app } from "electron";

// Bundle layout expected:
//   electron/bin/whisper-cli.exe         (whisper.cpp release binary)
//   desktop/whisper-model/ggml-base.bin  (fast enough for real-time voice
//                                          commands on CPU — small/medium
//                                          are more accurate but noticeably
//                                          slower per-turn since the model
//                                          is reloaded from disk every call)
// Both paths resolve relative to resourcesPath once packaged.

const BINARY_PATH = app.isPackaged
  ? path.join(process.resourcesPath, "bin", "whisper-cli.exe")
  : path.join(process.cwd(), "electron", "bin", "whisper-cli.exe");

const MODEL_PATH = app.isPackaged
  ? path.join(process.resourcesPath, "whisper-model", "ggml-base.bin")
  : path.join(process.cwd(), "whisper-model", "ggml-base.bin");

const SAMPLE_RATE = 16000;

// Set to true temporarily while debugging — keeps the wav files on disk
// instead of deleting them after each transcription attempt.
const DEBUG_KEEP_WAV = true;

// Below this many raw PCM bytes (~0.3s of 16kHz mono 16-bit audio), there's
// not enough signal for a real word — skip calling whisper.cpp entirely
// rather than wasting a subprocess spawn on a click/pop/breath.
const MIN_PCM_BYTES_FOR_TRANSCRIPTION = 16000 * 2 * 0.3;

// Biases whisper.cpp's decoding toward these words/phrases — dramatically
// improves recognition of "VSmart" (not a real dictionary word, so the
// model otherwise guesses at similar-sounding real words instead).
const RECOGNITION_PROMPT = "VSmart AI assistant. Hey VSmart. Okay VSmart.";

// Whisper (especially smaller models) commonly "hallucinates" these exact
// phrases when fed silence, background hiss, or non-speech noise. If the
// ENTIRE trimmed transcript is just one of these (case-insensitive), treat
// it as if nothing was said rather than dispatching it as a real command.
const HALLUCINATION_PHRASES = new Set([
  "you", "thank you", "thanks for watching", "bye", "bye bye",
  "[blank_audio]", "(blank audio)", "[silence]", "(silence)",
  "subtitles by the amara.org community", ".", "..", "...",
]);

// Raw 16-bit PCM mono chunks accumulate here for the current turn.
let chunks: Buffer[] = [];

export function initWhisper(): boolean {
  const binOk = fs.existsSync(BINARY_PATH);
  const modelOk = fs.existsSync(MODEL_PATH);

  if (!binOk) {
    console.error("Whisper binary not found at:", BINARY_PATH);
  }
  if (!modelOk) {
    console.error("Whisper model not found at:", MODEL_PATH);
  }

  if (binOk && modelOk) {
    console.log("Whisper ready. Binary:", BINARY_PATH, "Model:", MODEL_PATH);
  }
  return binOk && modelOk;
}

/** Appends a chunk of 16-bit PCM audio (mono, 16kHz) to the current turn's buffer. */
export function processAudioChunk(buffer: Buffer): void {
  chunks.push(buffer);
}

/** Clears the buffer — call at the start of a new turn. */
export function resetRecognizer(): void {
  chunks = [];
}

// Wraps raw PCM16 data in a minimal WAV header so whisper.cpp can read it.
function pcmToWav(pcm: Buffer, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  const byteRate = sampleRate * 2; // mono, 16-bit
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

// Maps the app's ReplyLang ("en"/"hi") to a whisper.cpp language code.
// Falls back to "auto" for anything unrecognized rather than guessing wrong.
function toWhisperLangCode(lang?: string): string {
  if (lang === "hi") return "hi";
  if (lang === "en") return "en";
  return "auto";
}

// True if the transcript is empty, or is nothing but a known Whisper
// hallucination artifact — these should be treated as "nothing was said".
function isHallucination(transcript: string): boolean {
  const cleaned = transcript.trim().toLowerCase().replace(/[.,!?]+$/g, "");
  return cleaned.length === 0 || HALLUCINATION_PHRASES.has(cleaned);
}

/**
 * Runs whisper.cpp on everything accumulated since the last reset, and
 * returns the transcript. Clears the buffer afterward regardless of outcome.
 * `lang` is an explicit "en"/"hi" hint — auto-detect is unreliable on short
 * command-length clips and can lock onto the wrong language entirely.
 */
export async function finalizeTranscription(lang?: string): Promise<string> {
  const pcm = Buffer.concat(chunks);
  chunks = [];

  console.log("finalizeTranscription: pcm bytes =", pcm.length);

  if (pcm.length < MIN_PCM_BYTES_FOR_TRANSCRIPTION) {
    console.warn("finalizeTranscription: clip too short, skipping whisper call.");
    return "";
  }

  const wav = pcmToWav(pcm, SAMPLE_RATE);
  const tmpPath = path.join(os.tmpdir(), `vsmart-turn-${Date.now()}.wav`);

  try {
    fs.writeFileSync(tmpPath, wav);
  } catch (writeErr) {
    console.error("finalizeTranscription: failed to write wav file:", writeErr);
    return "";
  }

  try {
    const stat = fs.statSync(tmpPath);
    console.log("finalizeTranscription: wrote wav file", tmpPath, "size =", stat.size);
  } catch (statErr) {
    console.error("finalizeTranscription: wav file missing right after write:", statErr);
    return "";
  }

  const langCode = toWhisperLangCode(lang);

  return new Promise((resolve) => {
    execFile(
      BINARY_PATH,
      [
        "-m", MODEL_PATH,
        "-f", tmpPath,
        "-l", langCode,     // explicit language hint (or "auto" as a fallback)
        "-nt",              // no timestamps
        "-np",              // no progress output
        "--prompt", RECOGNITION_PROMPT  // biases decoding toward the wake word
      ],
      { timeout: 60000 },
      (error, stdout, stderr) => {
        const cleanup = () => {
          if (!DEBUG_KEEP_WAV) {
            fs.unlink(tmpPath, () => {}); // best-effort cleanup, ignore failures
          } else {
            console.log("DEBUG_KEEP_WAV enabled — kept wav at:", tmpPath);
          }
        };

        if (error) {
          console.error("Whisper transcription failed:", error);
          console.error("Whisper exit code:", (error as any).code);
          console.error("Whisper stderr:", stderr);
          console.error("Whisper stdout:", stdout);
          cleanup();
          resolve("");
          return;
        }

        cleanup();
        const transcript = stdout.trim();
        console.log("finalizeTranscription: Whisper heard ->", JSON.stringify(transcript), "(lang:", langCode + ")");

        if (isHallucination(transcript)) {
          console.log("finalizeTranscription: discarded as likely hallucination/silence.");
          resolve("");
          return;
        }

        resolve(transcript);
      }
    );
  });
}