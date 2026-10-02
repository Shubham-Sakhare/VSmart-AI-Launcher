// ═══════════════════════════════════════════════════════════════════════════
// VSmart Voice Pipeline
//
// Two concerns handled here:
//   1. useVoice() hook — mic capture, adaptive VAD, Whisper transcription,
//      wake-word detection, conversation window management.
//   2. speak() / cancelSpeech() / isSpeaking() — TTS output via Microsoft
//      Edge neural Indian voices with offline fallback.
//
// NOISE REJECTION STRATEGY:
//   • 1-second calibration using p95 (not average) of ambient RMS
//   • threshold = max(p95 × 3.5, 0.015), capped at 0.080
//   • 3 consecutive above-threshold chunks required before speech is confirmed
//     (~768ms — filters fan gusts, coughs, single knocks)
//   • 3 consecutive quiet chunks required before arming the end-of-turn timer
//     (prevents chopping mid-sentence pauses)
//   • 500ms minimum speech duration — discards accidental mic pops
//   • Dynamic recalibration every 8 seconds while idle — if user turns on
//     music/TV after calibration, threshold automatically adjusts upward
// ═══════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const SAMPLE_RATE = 16000;

// ── VAD constants ─────────────────────────────────────────────────────────────
const CALIBRATION_MS          = 1000;  // measure ambient noise for 1s on mic open
const THRESHOLD_MULTIPLIER    = 3.5;   // p95_ambient × 3.5 = speech threshold
const MIN_THRESHOLD           = 0.015; // never trigger below this RMS
const MAX_THRESHOLD           = 0.080; // cap so normal speech always clears it
const SPEECH_CONFIRM_CHUNKS   = 3;     // consecutive above-thr chunks → speech start
const SPEECH_END_CHUNKS       = 3;     // consecutive quiet chunks → arm end-timer
const VAD_SILENCE_MS          = 1000;  // silence after speech → finalize turn
const MIN_SPEECH_MS           = 500;   // discard turns shorter than this
const SILENCE_TIMEOUT_MS      = 7000;  // hard limit per turn (stuck-mic guard)
const RECALIBRATE_INTERVAL_MS = 8000;  // dynamic recalibration interval
const RECALIBRATE_WINDOW_MS   = 500;   // sampling window per recalibration
const WAKE_RESTART_MS         = 400;   // delay before restarting mic (wake mode)
const CONVERSATION_MS         = 12000; // follow-up window after a command

// ── Wake word variants ────────────────────────────────────────────────────────
// Whisper mis-hears "VSmart" — accept common phonetic variants
const WAKE_RE =
  /\b(v\.?\s*smart|vsmart|vismart|is\s*mart|es\s*mart|the\s*smart|we\s*smart|b\.?\s*smart|bsmart)\b/i;

// ── Thinking fillers ──────────────────────────────────────────────────────────
// Spoken immediately after Whisper returns so there's no silent gap while
// the LLM processes. Makes the assistant feel alive, not frozen.
const FILLERS_EN = ["Sure, on it.", "Got it.", "One sec.", "Right away.", "Hmm, let me check."];
const FILLERS_HI = ["हाँ बॉस, देखता हूँ।", "जी बॉस, अभी करता हूँ।", "ठीक है, एक सेकंड।", "समझ गया।"];
const filler = (lang: string) => {
  const pool = lang.toLowerCase().startsWith("hi") ? FILLERS_HI : FILLERS_EN;
  return pool[Math.floor(Math.random() * pool.length)];
};

// ── Greetings ─────────────────────────────────────────────────────────────────
function greeting(hi: boolean): string {
  const h = new Date().getHours();
  if (hi) {
    if (h >= 5 && h < 12)  return "सुप्रभात बॉस, क्या काम है?";
    if (h >= 12 && h < 17) return "नमस्ते बॉस, क्या काम है?";
    if (h >= 17 && h < 21) return "शुभ संध्या बॉस, क्या काम है?";
    return "नमस्ते बॉस, क्या काम है?";
  }
  if (h >= 5 && h < 12)  return "Good Morning Boss, how can I help?";
  if (h >= 12 && h < 17) return "Good Afternoon Boss, how can I help?";
  if (h >= 17 && h < 21) return "Good Evening Boss, how can I help?";
  return "Good Night Boss, how can I help?";
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface UseVoiceOptions {
  onCommand: (transcript: string) => void;
  lang?: string;
  wakeWordEnabled?: boolean;
}
export type VoiceControls = ReturnType<typeof useVoice>;

// ═══════════════════════════════════════════════════════════════════════════
// useVoice hook
// ═══════════════════════════════════════════════════════════════════════════
export function useVoice({
  onCommand,
  lang = "en-IN",
  wakeWordEnabled = false,
}: UseVoiceOptions) {
  const [listening,    setListening]    = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [interimText,  setInterimText]  = useState("");
  const [supported,    setSupported]    = useState(true);
  const [errorMsg,     setErrorMsg]     = useState<string | null>(null);
  const [micLevel,     setMicLevel]     = useState(0);

  // ── Stable refs ─────────────────────────────────────────────────────────
  const onCommandRef       = useRef(onCommand);      onCommandRef.current = onCommand;
  const wakeEnabledRef     = useRef(wakeWordEnabled); wakeEnabledRef.current = wakeWordEnabled;
  const whisperLangRef     = useRef("en");
  whisperLangRef.current   = lang.toLowerCase().startsWith("hi") ? "hi" : "en";

  // ── Audio graph refs ─────────────────────────────────────────────────────
  const audioCtxRef    = useRef<AudioContext | null>(null);
  const streamRef      = useRef<MediaStream | null>(null);
  const processorRef   = useRef<AudioWorkletNode | ScriptProcessorNode | null>(null);

  // ── VAD state refs ───────────────────────────────────────────────────────
  const silenceTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const vadTimerRef      = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasSpeechRef     = useRef(false);
  const aboveCountRef    = useRef(0);
  const belowCountRef    = useRef(0);
  const speechMsRef      = useRef(0);
  const calibratingRef   = useRef(false);
  const calibSamplesRef  = useRef<number[]>([]);
  const thresholdRef     = useRef(MIN_THRESHOLD);

  // ── Recalibration refs ───────────────────────────────────────────────────
  const recalTimerRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const recalSamplesRef  = useRef<number[]>([]);
  const recalingRef      = useRef(false);

  // ── Conversation / barge-in refs ─────────────────────────────────────────
  const inConvRef        = useRef(false);
  const convTimerRef     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bargeInOnlyRef   = useRef(false);
  const bargedInRef      = useRef(false);

  // ── Forward ref for finalizeAndDispatch (avoids stale closure) ──────────
  const finalizeRef      = useRef<() => void>(() => {});
  const startRef         = useRef<(opts?: { bargeInOnly?: boolean }) => void>(() => {});

  // ── Open conversation window ─────────────────────────────────────────────
  const openConvWindow = useCallback(() => {
    inConvRef.current = true;
    if (convTimerRef.current) clearTimeout(convTimerRef.current);
    convTimerRef.current = setTimeout(() => {
      inConvRef.current = false;
      convTimerRef.current = null;
    }, CONVERSATION_MS);
  }, []);

  // ── Stop audio capture and reset all VAD state ───────────────────────────
  const stopCapture = useCallback(() => {
    if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current);   silenceTimerRef.current = null; }
    if (vadTimerRef.current)     { clearTimeout(vadTimerRef.current);        vadTimerRef.current = null; }
    if (recalTimerRef.current)   { clearInterval(recalTimerRef.current);     recalTimerRef.current = null; }
    hasSpeechRef.current   = false;
    aboveCountRef.current  = 0;
    belowCountRef.current  = 0;
    calibratingRef.current = false;
    calibSamplesRef.current = [];
    recalSamplesRef.current = [];
    recalingRef.current    = false;
    speechMsRef.current    = 0;
    processorRef.current?.disconnect();
    processorRef.current   = null;
    audioCtxRef.current?.close();
    audioCtxRef.current    = null;
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current      = null;
    setListening(false);
    setInterimText("");
    setMicLevel(0);
  }, []);

  // ── Hard silence timeout (stuck-mic guard) ───────────────────────────────
  const resetSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    silenceTimerRef.current = setTimeout(() => finalizeRef.current(), SILENCE_TIMEOUT_MS);
  }, []);

  // ── Finalize turn — send audio to Whisper, dispatch transcript ───────────
  const finalizeAndDispatch = useCallback(async () => {
    const wasBargeOnly = bargeInOnlyRef.current;
    const didBargeIn   = bargedInRef.current;
    const longEnough   = speechMsRef.current >= MIN_SPEECH_MS;
    bargeInOnlyRef.current = false;
    bargedInRef.current    = false;

    stopCapture();

    if ((wasBargeOnly && !didBargeIn) || !longEnough) {
      if (wakeEnabledRef.current) setTimeout(() => startRef.current(), WAKE_RESTART_MS);
      return;
    }

    setTranscribing(true);
    setInterimText("Processing…");

    let transcript = "";
    try {
      transcript = (await window.vsmart.voice.finalize(whisperLangRef.current))?.trim() ?? "";
    } catch { /* Whisper failed — transcript stays empty */ }
    finally {
      setTranscribing(false);
      setInterimText("");
    }

    const isHi = lang.toLowerCase().startsWith("hi");

    if (transcript) {
      const lo       = transcript.toLowerCase();
      const wakeM    = lo.match(WAKE_RE);
      const hasWake  = !!wakeM;
      const afterWake = hasWake
        ? transcript.slice((wakeM!.index ?? 0) + wakeM![0].length).trim()
        : transcript;

      console.log(`[Voice] "${transcript}" wake=${hasWake} barge=${didBargeIn} conv=${inConvRef.current} thr=${thresholdRef.current.toFixed(3)}`);

      if (hasWake && !afterWake) {
        // Wake word only — greet and open window
        speak(greeting(isHi), lang);
        openConvWindow();
      } else if (didBargeIn || hasWake || inConvRef.current || !wakeEnabledRef.current) {
        // Real command — play filler immediately so there's no silent gap
        speak(filler(lang), lang);
        onCommandRef.current(afterWake || transcript);
        openConvWindow();
      }
    } else {
      // Whisper returned nothing — give feedback only on real attempts
      if (didBargeIn || inConvRef.current || !wakeEnabledRef.current) {
        const retries_hi = ["माफ़ कीजिए बॉस, ठीक से सुनाई नहीं दिया।","बॉस, एक बार और बोलिए।","समझ नहीं आया, दोबारा बोलिए।"];
        const retries_en = ["Sorry Boss, didn't catch that — say it again?","Hmm, missed that. Try once more.","Could you repeat that, Boss?"];
        const pool = isHi ? retries_hi : retries_en;
        speak(pool[Math.floor(Math.random() * pool.length)], lang);
        setErrorMsg(isHi ? "दोबारा बोलिए…" : "Didn't catch that — try again.");
        setTimeout(() => setErrorMsg(null), 3000);
      }
    }

    if (wakeEnabledRef.current) setTimeout(() => startRef.current(), WAKE_RESTART_MS);
  }, [lang, stopCapture, openConvWindow]);

  finalizeRef.current = () => { void finalizeAndDispatch(); };

  // ── Start listening ───────────────────────────────────────────────────────
  const startListening = useCallback(async (opts?: { bargeInOnly?: boolean }) => {
    if (listening) return;

    const isBargeOnly = !!opts?.bargeInOnly;
    bargeInOnlyRef.current = isBargeOnly;
    bargedInRef.current    = false;
    speechMsRef.current    = 0;

    if (!isBargeOnly && isSpeaking()) {
      if (wakeEnabledRef.current) setTimeout(() => startRef.current(), 800);
      else setErrorMsg("Wait, I'm still talking…");
      return;
    }

    setErrorMsg(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: SAMPLE_RATE,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,  // hardware AGC keeps mic level healthy
        },
      });

      streamRef.current  = stream;
      const audioCtx     = new AudioContext({ sampleRate: SAMPLE_RATE });
      audioCtxRef.current = audioCtx;
      const source       = audioCtx.createMediaStreamSource(stream);

      // Start calibration
      calibratingRef.current  = true;
      calibSamplesRef.current = [];
      thresholdRef.current    = MIN_THRESHOLD;
      const calibStart        = performance.now();
      const chunkMs           = (4096 / SAMPLE_RATE) * 1000; // ~256ms per chunk

      // ── Per-chunk handler ────────────────────────────────────────────────
      const handleChunk = (int16: Int16Array, rms: number) => {
        window.vsmart.voice.sendAudioChunk(int16.buffer as ArrayBuffer);
        setMicLevel(Math.min(1, rms * 8));

        // ── Phase 1: Initial calibration ──────────────────────────────────
        if (calibratingRef.current) {
          calibSamplesRef.current.push(rms);
          if (performance.now() - calibStart >= CALIBRATION_MS) {
            calibratingRef.current = false;
            const sorted = [...calibSamplesRef.current].sort((a, b) => a - b);
            const p95    = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
            thresholdRef.current = Math.min(MAX_THRESHOLD, Math.max(MIN_THRESHOLD, p95 * THRESHOLD_MULTIPLIER));
            console.log(`[Voice] calibrated p95=${p95.toFixed(4)} -> thr=${thresholdRef.current.toFixed(4)}`);

            // ── Dynamic recalibration every 8s while idle ────────────────
            recalTimerRef.current = setInterval(() => {
              if (hasSpeechRef.current || calibratingRef.current) return;
              recalingRef.current    = true;
              recalSamplesRef.current = [];
              setTimeout(() => {
                recalingRef.current = false;
                const s = recalSamplesRef.current;
                if (s.length < 5) return;
                const s2   = [...s].sort((a, b) => a - b);
                const p95b = s2[Math.floor(s2.length * 0.95)] ?? 0;
                const newT = Math.min(MAX_THRESHOLD, Math.max(MIN_THRESHOLD, p95b * THRESHOLD_MULTIPLIER));
                // Only step up — never lower threshold during a quiet moment
                if (newT > thresholdRef.current * 1.2) {
                  thresholdRef.current = newT;
                  console.log(`[Voice] recalibrated -> thr=${newT.toFixed(4)}`);
                }
              }, RECALIBRATE_WINDOW_MS);
            }, RECALIBRATE_INTERVAL_MS);
          }
          return;
        }

        // Feed dynamic recalibrator when idle
        if (recalingRef.current && !hasSpeechRef.current) {
          recalSamplesRef.current.push(rms);
        }

        setInterimText(hasSpeechRef.current ? "Listening…" : "");

        // ── Phase 2: VAD detection ────────────────────────────────────────
        if (rms > thresholdRef.current) {
          aboveCountRef.current += 1;
          belowCountRef.current  = 0;

          // Need SPEECH_CONFIRM_CHUNKS consecutive to confirm speech started
          if (!hasSpeechRef.current && aboveCountRef.current < SPEECH_CONFIRM_CHUNKS) return;

          const justStarted = !hasSpeechRef.current;
          hasSpeechRef.current  = true;
          speechMsRef.current  += chunkMs;

          if (justStarted && isSpeaking()) { cancelSpeech(); bargedInRef.current = true; }

          if (vadTimerRef.current) { clearTimeout(vadTimerRef.current); vadTimerRef.current = null; }
        } else {
          aboveCountRef.current = 0;

          if (hasSpeechRef.current) {
            belowCountRef.current += 1;
            // Need SPEECH_END_CHUNKS consecutive quiet chunks before arming end-timer
            if (belowCountRef.current >= SPEECH_END_CHUNKS && !vadTimerRef.current) {
              vadTimerRef.current = setTimeout(() => {
                vadTimerRef.current = null;
                finalizeRef.current();
              }, VAD_SILENCE_MS);
            }
          }
        }
      };

      // ── Prefer AudioWorkletNode (off-main-thread) ─────────────────────
      let workletOk = false;
      try {
        await audioCtx.audioWorklet.addModule("/audio-processor.js");
        workletOk = true;
      } catch (e) {
        console.warn("[Voice] AudioWorklet unavailable, using ScriptProcessorNode:", e);
      }

      if (workletOk) {
        const node = new AudioWorkletNode(audioCtx, "vsmart-capture");
        processorRef.current = node;
        node.port.onmessage = (e: MessageEvent<{ int16: ArrayBuffer; rms: number }>) =>
          handleChunk(new Int16Array(e.data.int16), e.data.rms);
        source.connect(node);
        const gain = audioCtx.createGain(); gain.gain.value = 0;
        node.connect(gain); gain.connect(audioCtx.destination);
      } else {
        // ScriptProcessorNode fallback (2048 buffer for lower latency)
        const proc = audioCtx.createScriptProcessor(2048, 1, 1);
        processorRef.current = proc;
        proc.onaudioprocess = (e) => {
          const f32  = e.inputBuffer.getChannelData(0);
          const i16  = new Int16Array(f32.length);
          let sum    = 0;
          for (let i = 0; i < f32.length; i++) {
            const s = Math.max(-1, Math.min(1, f32[i]));
            i16[i]  = s < 0 ? s * 0x8000 : s * 0x7fff;
            sum    += s * s;
          }
          handleChunk(i16, Math.sqrt(sum / f32.length));
        };
        const gain = audioCtx.createGain(); gain.gain.value = 0;
        source.connect(proc); proc.connect(gain); gain.connect(audioCtx.destination);
      }

      window.vsmart.voice.reset();
      setListening(true);
      resetSilenceTimer();

    } catch (err) {
      bargeInOnlyRef.current = false;
      setErrorMsg(
        err instanceof Error && err.name === "NotAllowedError"
          ? "Microphone access denied. Allow mic permission and try again."
          : "Could not access the microphone."
      );
    }
  }, [listening, resetSilenceTimer]);

  startRef.current = startListening;

  const stopListening  = useCallback(() => stopCapture(), [stopCapture]);
  const toggleListening = useCallback(() => {
    if (listening) stopListening(); else startListening();
  }, [listening, startListening, stopListening]);

  // Auto-start in wake mode
  useEffect(() => {
    if (wakeWordEnabled && !listening) startRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wakeWordEnabled]);

  // Barge-in while AI is speaking
  useEffect(() => {
    registerSpeechStartListener(() => {
      if (!wakeEnabledRef.current && !listening) startRef.current({ bargeInOnly: true });
    });
    return () => registerSpeechStartListener(null);
  }, [listening]);

  // Cleanup on unmount
  useEffect(() => {
    if (!window.vsmart?.voice) { setSupported(false); setErrorMsg("Voice bridge not available."); return; }
    return () => stopCapture();
  }, [stopCapture]);

  return useMemo(() => ({
    listening, transcribing, wakeActive: listening,
    interimText, supported, errorMsg, micLevel,
    startListening, stopListening, toggleListening,
  }), [listening, transcribing, interimText, supported, errorMsg, micLevel, startListening, stopListening, toggleListening]);
}

// ═══════════════════════════════════════════════════════════════════════════
// TTS — speak() and helpers
// ═══════════════════════════════════════════════════════════════════════════

let preferredVoiceName: string | null  = null;
let preferredGender: "male" | "female" = "female";

export const setPreferredVoice  = (n: string | null)          => { preferredVoiceName = n; };
export const getPreferredVoice  = ()                           => preferredVoiceName;
export const setPreferredGender = (g: "male" | "female")      => { preferredGender = g; };

let onSpeechStart: (() => void) | null = null;
const registerSpeechStartListener = (cb: (() => void) | null) => { onSpeechStart = cb; };

let currentAudio: HTMLAudioElement | null = null;

/**
 * Speak text using Microsoft Edge neural Indian voice (requires internet).
 * Falls back to OS SpeechSynthesis API if Edge TTS is unavailable.
 * Cancels any currently playing speech before starting.
 */
export function speak(text: string, lang = "en-IN") {
  if (!text.trim()) return;

  // Cancel current speech
  window.speechSynthesis?.cancel();
  currentAudio?.pause();
  currentAudio = null;

  const shortLang: "en" | "hi" = lang.toLowerCase().startsWith("hi") ? "hi" : "en";

  if (window.vsmart?.tts?.synthesize) {
    window.vsmart.tts.synthesize(text, shortLang, preferredGender)
      .then(dataUrl => {
        if (!dataUrl) { speakOffline(text, lang); return; }
        const audio = new Audio(dataUrl);
        currentAudio = audio;
        audio.onplay  = () => onSpeechStart?.();
        audio.onerror = () => speakOffline(text, lang);
        audio.play().catch(() => speakOffline(text, lang));
      })
      .catch(() => speakOffline(text, lang));
  } else {
    speakOffline(text, lang);
  }
}

export function cancelSpeech() {
  window.speechSynthesis?.cancel();
  currentAudio?.pause();
  currentAudio = null;
}

export function isSpeaking(): boolean {
  return !!window.speechSynthesis?.speaking ||
    (!!currentAudio && !currentAudio.paused && !currentAudio.ended);
}

function speakOffline(text: string, lang: string) {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();

  const utt   = new SpeechSynthesisUtterance(text);
  utt.lang    = lang;
  utt.rate    = 1.05;
  utt.pitch   = 1.05;
  utt.onstart = () => onSpeechStart?.();

  const pickVoice = () => {
    const voices = window.speechSynthesis.getVoices();
    if (!voices.length) return;

    if (preferredVoiceName) {
      const v = voices.find(v => v.name === preferredVoiceName);
      if (v) { utt.voice = v; utt.lang = v.lang; return; }
    }

    const isHi    = lang.toLowerCase().startsWith("hi");
    const target  = isHi ? "hi-in" : "en-in";
    const natural = ["neerja", "swara"];
    const legacy  = ["heera", "priya", "kalpana", "veena", "raveena"];

    const chosen =
      voices.find(v => natural.some(n => v.name.toLowerCase().includes(n)) && v.lang?.toLowerCase() === target) ||
      voices.find(v => v.lang?.toLowerCase() === target && legacy.some(n => v.name.toLowerCase().includes(n))) ||
      voices.find(v => v.lang?.toLowerCase() === target && v.name.toLowerCase().includes("female")) ||
      voices.find(v => v.lang?.toLowerCase() === target);

    if (chosen) { utt.voice = chosen; utt.lang = chosen.lang; }
  };

  window.speechSynthesis.getVoices().length ? pickVoice() : (window.speechSynthesis.onvoiceschanged = pickVoice);
  window.speechSynthesis.speak(utt);
}
