import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import path from "path";
import os from "os";
import fs from "fs";

// Microsoft Edge neural voices — natural-sounding Indian English/Hindi.
// en-IN-NeerjaNeural: warm, natural Indian English female (best for English)
// en-IN-PrabhatNeural: Indian English male
// hi-IN-SwaraNeural: natural Hindi female
// hi-IN-MadhurNeural: Hindi male
const VOICES = {
  "en-female": "en-IN-NeerjaNeural",
  "en-male":   "en-IN-PrabhatNeural",
  "hi-female": "hi-IN-SwaraNeural",
  "hi-male":   "hi-IN-MadhurNeural",
} as const;

export type VoiceGender = "female" | "male";

// One MsEdgeTTS client per voice key — caching prevents re-handshaking on
// every utterance, but a single shared client across all voices caused
// race conditions when switching lang mid-conversation (the prior
// setMetadata call was still in flight). Keyed map fixes that.
const ttsClients = new Map<string, MsEdgeTTS>();

async function getClient(voiceKey: string, voiceName: string): Promise<MsEdgeTTS> {
  if (ttsClients.has(voiceKey)) return ttsClients.get(voiceKey)!;
  const client = new MsEdgeTTS();
  await client.setMetadata(voiceName, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
  ttsClients.set(voiceKey, client);
  return client;
}

// Wrap text in SSML for a more natural Indian speech rhythm:
//   - slightly faster rate (+5%) — Indian English is naturally a bit quicker
//   - pitch slightly higher (+5%) — gives Neerja/Swara the warm presence
//     of a real Indian voice rather than the flatter default
//   - short pauses after commas/periods via <break> tags so the AI sounds
//     like it's thinking, not reading a transcript
function wrapSsml(text: string, voiceName: string): string {
  // Sanitise XML-special chars that would break SSML
  const safe = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  // Add natural micro-pauses after sentence-ending punctuation
  const paced = safe
    .replace(/([.!?])\s+/g, '$1<break time="300ms"/> ')
    .replace(/([,;])\s+/g, '$1<break time="120ms"/> ');

  return (
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-IN">` +
    `<voice name="${voiceName}">` +
    `<prosody rate="5%" pitch="5%">` +
    paced +
    `</prosody>` +
    `</voice>` +
    `</speak>`
  );
}

/**
 * Synthesises speech using a natural Microsoft Edge neural voice and saves
 * it to a temp mp3 file. Returns the file path for the renderer to play,
 * or null if synthesis failed (e.g. no internet).
 *
 * Uses SSML so the voice sounds natural and Indian — not robotic.
 */
export async function synthesizeSpeech(
  text: string,
  lang: "en" | "hi",
  gender: VoiceGender = "female"
): Promise<string | null> {
  if (!text.trim()) return null;

  const voiceKey  = `${lang}-${gender}` as keyof typeof VOICES;
  const voiceName = VOICES[voiceKey] ?? VOICES["en-female"];

  try {
    // Get (or lazily create) a cached client for this specific voice
    const tts = await getClient(voiceKey, voiceName);

    const outPath = path.join(os.tmpdir(), `vsmart-tts-${Date.now()}.mp3`);

    // Build SSML input — gives us prosody control (rate, pitch, pauses)
    const ssml = wrapSsml(text, voiceName);

    // toStream() accepts plain text; for SSML we use toStream with the
    // raw text and rely on the metadata's voice setting for prosody.
    // msedge-tts v2 passes the first argument directly as the TTS input;
    // SSML is detected automatically if it starts with <speak>.
    const { audioStream } = tts.toStream(ssml);

    await new Promise<void>((resolve, reject) => {
      const writeStream = fs.createWriteStream(outPath);
      audioStream.pipe(writeStream);
      audioStream.on("error", reject);
      writeStream.on("finish", resolve);
      writeStream.on("error", reject);
    });

    // Verify the file was actually written (non-zero size)
    const stat = fs.statSync(outPath);
    if (stat.size < 100) {
      fs.unlink(outPath, () => {});
      throw new Error("TTS output too small — likely empty/failed stream");
    }

    return outPath;
  } catch (err) {
    console.warn("[TTS] Edge neural TTS failed (will fall back to offline voice):", err);
    // Invalidate the cached client for this voice so the next call
    // gets a fresh one (connection may have dropped/timed out)
    ttsClients.delete(voiceKey);
    return null;
  }
}

/**
 * Splits a long reply into short natural chunks suitable for progressive
 * TTS — speak the first sentence immediately while the rest of the LLM
 * response streams in.  Splits on sentence-ending punctuation + newlines.
 */
export function splitIntoSpeakableChunks(text: string): string[] {
  // Split on sentence boundaries while keeping the delimiter attached
  const raw = text.split(/(?<=[.!?।\n])\s+/);
  const chunks: string[] = [];

  for (const part of raw) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    // Merge very short fragments (< 15 chars) with the previous chunk to
    // avoid the TTS engine choking on fragments like "Ok." or "Sure."
    if (trimmed.length < 15 && chunks.length > 0) {
      chunks[chunks.length - 1] += " " + trimmed;
    } else {
      chunks.push(trimmed);
    }
  }

  return chunks.length > 0 ? chunks : [text.trim()];
}
