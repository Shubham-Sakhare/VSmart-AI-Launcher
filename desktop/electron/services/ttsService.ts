import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import path from "path";
import os from "os";
import fs from "fs";

// Microsoft Edge's free neural voices — genuinely natural-sounding Indian
// English/Hindi voices, not the robotic legacy Windows SAPI voices that
// speechSynthesis.speak() falls back to. Requires internet (calls
// Microsoft's edge read-aloud service) — if it's unavailable, the caller
// falls back to the offline browser TTS instead.
const VOICES = {
  "en-female": "en-IN-NeerjaNeural",
  "en-male": "en-IN-PrabhatNeural",
  "hi-female": "hi-IN-SwaraNeural",
  "hi-male": "hi-IN-MadhurNeural",
} as const;

export type VoiceGender = "female" | "male";

let cachedTts: MsEdgeTTS | null = null;

async function getTtsClient(): Promise<MsEdgeTTS> {
  if (cachedTts) return cachedTts;
  cachedTts = new MsEdgeTTS();
  return cachedTts;
}

/**
 * Synthesizes speech using a natural Microsoft Edge neural voice and saves
 * it to a temp mp3 file. Returns the file path for the renderer to play,
 * or null if synthesis failed (e.g. no internet) so the caller can fall
 * back to offline browser speechSynthesis instead.
 */
export async function synthesizeSpeech(
  text: string,
  lang: "en" | "hi",
  gender: VoiceGender = "female"
): Promise<string | null> {
  if (!text.trim()) return null;

  const voiceKey = `${lang}-${gender}` as keyof typeof VOICES;
  const voiceName = VOICES[voiceKey] ?? VOICES["en-female"];

  try {
    const tts = await getTtsClient();
    await tts.setMetadata(voiceName, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

    const outPath = path.join(os.tmpdir(), `vsmart-tts-${Date.now()}.mp3`);
    const { audioStream } = tts.toStream(text);

    await new Promise<void>((resolve, reject) => {
      const writeStream = fs.createWriteStream(outPath);
      audioStream.pipe(writeStream);
      audioStream.on("error", reject);
      writeStream.on("finish", () => resolve());
      writeStream.on("error", reject);
    });

    return outPath;
  } catch (err) {
    console.warn("Edge neural TTS failed (falling back to offline voice):", err);
    return null;
  }
}