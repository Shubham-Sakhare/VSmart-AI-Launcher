import path from "path";
import fs from "fs";
import os from "os";
import { execFile } from "child_process";
import { app } from "electron";

// Binary and model paths
function resolveModelPath(preferred: string, fallback: string): string {
  const base = app.isPackaged ? process.resourcesPath : process.cwd();
  const preferredFull = path.join(base, "whisper-model", preferred);
  if (fs.existsSync(preferredFull)) return preferredFull;
  return path.join(base, "whisper-model", fallback);
}

const BINARY_PATH = app.isPackaged
  ? path.join(process.resourcesPath, "bin", "whisper-cli.exe")
  : path.join(process.cwd(), "electron", "bin", "whisper-cli.exe");

// ggml-base.bin (141MB, 3â€“8s on mid-range CPU) as primary.
const MODEL_PATH = resolveModelPath("ggml-base.bin", "ggml-small.bin");

const SAMPLE_RATE = 16000;
const DEBUG_KEEP_WAV = false;

// Write WAVs to the app's own userData directory instead of %TEMP%.
// Windows Defender aggressively scans %TEMP% for new files â€” when it opens
// the WAV for scanning at the same moment whisper-cli tries to read it,
// miniaudio's file open blocks indefinitely (the "trying to decode with
// miniaudio" hang). The app's userData dir is an exclusion path in most
// AV configs, so whisper-cli gets exclusive access immediately.
function getWavDir(): string {
  const dir = path.join(app.getPath("userData"), "vsmart-audio");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

// How long to wait after writing the WAV before spawning whisper-cli.
// Gives Windows' file system event queue time to flush and any lingering
// AV scan on the file to complete, eliminating the miniaudio open-race.
const POST_WRITE_DELAY_MS = 300;

const MIN_PCM_BYTES = 16000 * 2 * 0.25; // 0.25s minimum

const SILENCE_AMPLITUDE_RATIO = 0.005;
const SILENCE_WINDOW_SAMPLES  = 800;

const RECOGNITION_PROMPT = "VSmart AI. Hey VSmart. Okay VSmart. Boss.";

const HALLUCINATION_PHRASES = new Set([
  "you", "thank you", "thanks for watching", "bye", "bye bye",
  "[blank_audio]", "(blank audio)", "[silence]", "(silence)",
  "subtitles by the amara.org community",
  ".", "..", "...",
  "thank you for watching", "please subscribe", "subscribe", "like and subscribe",
]);

const PROMPT_WORDS = new Set(
  RECOGNITION_PROMPT
    .toLowerCase()
    .replace(/[.,!?]+/g, "")
    .split(/\s+/)
    .filter(Boolean)
);

function isRepeatedWordHallucination(transcript: string): boolean {
  const words = transcript.toLowerCase().replace(/[.,!?]+/g, "").split(/\s+/).filter(Boolean);
  if (words.length < 3) return false;
  return new Set(words).size <= 2;
}

function isPromptEcho(transcript: string): boolean {
  const words = transcript.toLowerCase().replace(/[.,!?]+/g, "").split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 10) return false;
  return words.every(w => PROMPT_WORDS.has(w));
}

// Trim leading and trailing silence from PCM.
function trimSilence(pcm: Buffer): Buffer {
  const samples   = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length / 2);
  const threshold = Math.floor(SILENCE_AMPLITUDE_RATIO * 32767);
  const window    = SILENCE_WINDOW_SAMPLES;

  let startSample = 0;
  for (let i = 0; i < samples.length - window; i += window) {
    let maxAbs = 0;
    for (let j = i; j < i + window; j++) {
      const abs = Math.abs(samples[j]);
      if (abs > maxAbs) maxAbs = abs;
    }
    if (maxAbs > threshold) { startSample = Math.max(0, i - window); break; }
  }

  let endSample = samples.length;
  for (let i = samples.length - window; i > startSample; i -= window) {
    let maxAbs = 0;
    for (let j = i; j < Math.min(i + window, samples.length); j++) {
      const abs = Math.abs(samples[j]);
      if (abs > maxAbs) maxAbs = abs;
    }
    if (maxAbs > threshold) { endSample = Math.min(samples.length, i + window * 2); break; }
  }

  if (startSample === 0 && endSample === samples.length) return pcm;

  const trimmed = samples.slice(startSample, endSample);
  const out     = Buffer.from(trimmed.buffer).slice(
    trimmed.byteOffset,
    trimmed.byteOffset + trimmed.byteLength
  );
  console.log(`[Whisper] trimmed silence: ${samples.length} â†’ ${trimmed.length} samples`);
  return out;
}

// Software AGC â€” boost quiet audio up toward full scale.
function normalizeGain(pcm: Buffer): Buffer {
  const samples = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length / 2);
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const abs = Math.abs(samples[i]);
    if (abs > peak) peak = abs;
  }
  if (peak === 0) return pcm;

  const TARGET_PEAK = 0.85 * 32767;
  const gain = Math.min(12, TARGET_PEAK / peak);
  if (gain <= 1.05) return pcm;

  const boosted = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    boosted[i] = Math.max(-32768, Math.min(32767, Math.round(samples[i] * gain)));
  }
  console.log(`[Whisper] AGC gain x${gain.toFixed(2)} (peak=${peak}/32767)`);
  return Buffer.from(boosted.buffer);
}

function pcmToWav(pcm: Buffer, sampleRate: number): Buffer {
  const header   = Buffer.alloc(44);
  const byteRate = sampleRate * 2;
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function toWhisperLangCode(lang?: string): string {
  if (lang === "hi") return "hi";
  if (lang === "en") return "en";
  return "auto";
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

let chunks: Buffer[] = [];

export function initWhisper(): boolean {
  const binOk   = fs.existsSync(BINARY_PATH);
  const modelOk = fs.existsSync(MODEL_PATH);
  if (!binOk)   console.error("[Whisper] binary not found:", BINARY_PATH);
  if (!modelOk) console.error("[Whisper] model not found:", MODEL_PATH);
  if (binOk && modelOk) {
    console.log("Whisper ready. Binary:", BINARY_PATH, "Model:", path.basename(MODEL_PATH));
  }
  // Ensure WAV dir exists on startup
  try { getWavDir(); } catch { /* ignore */ }
  cleanupOldDebugWavs();
  return binOk && modelOk;
}

function cleanupOldDebugWavs(): void {
  try {
    const dirs      = [os.tmpdir(), path.join(app.getPath("userData"), "vsmart-audio")];
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    let removed = 0;
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) continue;
      for (const f of fs.readdirSync(dir).filter(f => f.startsWith("vsmart-turn-") && f.endsWith(".wav"))) {
        try {
          const fullPath = path.join(dir, f);
          if (fs.statSync(fullPath).mtimeMs < oneHourAgo) { fs.unlinkSync(fullPath); removed++; }
        } catch { /* ignore */ }
      }
    }
    if (removed > 0) console.log(`[Whisper] cleanup: removed ${removed} old wav(s).`);
  } catch (err) {
    console.warn("[Whisper] cleanup scan failed:", err);
  }
}

export function processAudioChunk(buffer: Buffer): void {
  chunks.push(buffer);
}

export function resetRecognizer(): void {
  chunks = [];
}

let transcribing = false;

export async function finalizeTranscription(lang?: string): Promise<string> {
  let pcm: Buffer = Buffer.concat(chunks);
  chunks = [];

  if (transcribing) {
    console.warn("[Whisper] already transcribing â€” dropped concurrent request.");
    return "";
  }

  console.log(`[Whisper] finalizing: ${pcm.length} bytes (${(pcm.length / 32000).toFixed(2)}s)`);

  if (pcm.length < MIN_PCM_BYTES) {
    console.warn("[Whisper] clip too short, skipping.");
    return "";
  }

  pcm = trimSilence(pcm);

  if (pcm.length < MIN_PCM_BYTES) {
    console.warn("[Whisper] clip too short after silence trim, skipping.");
    return "";
  }

  pcm = normalizeGain(pcm);

  const wav     = pcmToWav(pcm, SAMPLE_RATE);
  // Write to app userData dir, NOT %TEMP% â€” avoids AV scan race
  const wavDir  = getWavDir();
  const tmpPath = path.join(wavDir, `vsmart-turn-${Date.now()}.wav`);

  try {
    const fd = fs.openSync(tmpPath, "w");
    fs.writeSync(fd, wav);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
  } catch (writeErr) {
    console.error("[Whisper] failed to write wav:", writeErr);
    return "";
  }

  // Small delay: let the OS finish any file-open notifications (AV, indexer)
  // before whisper-cli tries to read the file. Eliminates the miniaudio hang.
  await sleep(POST_WRITE_DELAY_MS);

  const langCode    = toWhisperLangCode(lang);
  const execStarted = Date.now();
  // Use floor(cpus/2) capped at 4 â€” fast enough on base model, leaves RAM headroom
  const cpuCount    = Math.min(4, Math.max(2, Math.floor(os.cpus().length / 2)));

  console.log(
    `[Whisper] starting whisper-cli (model=${path.basename(MODEL_PATH)}, lang=${langCode}, threads=${cpuCount})â€¦`
  );

  transcribing = true;
  return new Promise((resolve) => {
    execFile(
      BINARY_PATH,
      [
        "-m", MODEL_PATH,
        "-f", tmpPath,
        "-l", langCode,
        "-nt",
        "-np",
        "-t", String(cpuCount),
        "--prompt", RECOGNITION_PROMPT,
      ],
      { timeout: 45000 },
      (error, stdout, stderr) => {
        transcribing = false;
        const elapsed = Date.now() - execStarted;

        const cleanup = () => {
          if (!DEBUG_KEEP_WAV) fs.unlink(tmpPath, () => {});
        };

        if (error) {
          console.error(`[Whisper] failed after ${elapsed}ms:`, error.message);
          if (stderr?.trim()) console.error("[Whisper] stderr:", stderr.slice(0, 300));
          cleanup();
          resolve("");
          return;
        }

        cleanup();
        const transcript = stdout.trim();
        console.log(`[Whisper] done in ${elapsed}ms â†’ "${transcript}" (${langCode})`);

        if (!transcript) { resolve(""); return; }

        const cleaned = transcript.trim().toLowerCase().replace(/[.,!?à¥¤]+$/g, "");

        if (HALLUCINATION_PHRASES.has(cleaned)) {
          console.log(`[Whisper] discarded hallucination: "${cleaned}"`);
          resolve(""); return;
        }
        if (isRepeatedWordHallucination(transcript)) {
          console.log(`[Whisper] discarded repeated-word hallucination: "${transcript}"`);
          resolve(""); return;
        }
        if (isPromptEcho(transcript)) {
          console.log(`[Whisper] discarded prompt echo: "${transcript}"`);
          resolve(""); return;
        }

        resolve(transcript);
      }
    );
  });
}
