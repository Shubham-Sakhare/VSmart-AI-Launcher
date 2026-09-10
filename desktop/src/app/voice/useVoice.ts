import { useCallback, useEffect, useRef, useState } from "react";

const SAMPLE_RATE = 16000;
const SILENCE_TIMEOUT_MS = 8000;
const WAKE_RESTART_DELAY_MS = 500;

// --- Adaptive VAD (Voice Activity Detection) ---
const CALIBRATION_MS = 400;
const THRESHOLD_MULTIPLIER = 4.5;
const MIN_ABSOLUTE_THRESHOLD = 0.015;
const MAX_THRESHOLD_CAP = 0.13;
const VAD_SILENCE_MS = 1100;

// A turn shorter than this (mostly silence/a click/a cough) is discarded
// without even asking Whisper to transcribe it.
const MIN_SPEECH_MS_TO_DISPATCH = 600;

// Requires a short sustained run above threshold before committing to
// "speech started" — filters out brief noise blips (a click, a thud,
// a single loud breath) that would otherwise falsely start a turn and
// eat into / delay the user's actual speech.
const SPEECH_CONFIRM_CHUNKS = 2; // ~2 chunks (~500ms) of sustained sound required

// Whisper often mis-hears "VSmart" (not a dictionary word) as similar-
// sounding variants — matching any of these makes wake-word detection
// forgiving instead of requiring an exact, unlikely-to-happen match.
const WAKE_WORD_VARIANTS = /\b(v\.?\s*smart|vsmart|vismart|is\s*mart|es\s*mart|the\s*smart|we\s*smart)\b/i;

/** "Good Morning", "Good Afternoon", "Good Evening", "Good Night" based on current hour. */
function timeBasedGreeting(): string {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return "Good Morning";
  if (hour >= 12 && hour < 17) return "Good Afternoon";
  if (hour >= 17 && hour < 21) return "Good Evening";
  return "Good Night";
}

interface UseVoiceOptions {
  onCommand: (transcript: string) => void;
  lang?: string;
  wakeWordEnabled?: boolean;
}

export type VoiceControls = ReturnType<typeof useVoice>;

export function useVoice({ onCommand, lang = "en-IN", wakeWordEnabled = false }: UseVoiceOptions) {
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [interimText, setInterimText] = useState("");
  const [supported, setSupported] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [micLevel, setMicLevel] = useState(0);

  const onCommandRef = useRef(onCommand);
  onCommandRef.current = onCommand;

  const wakeWordEnabledRef = useRef(wakeWordEnabled);
  wakeWordEnabledRef.current = wakeWordEnabled;

  const whisperLangRef = useRef("auto");
  whisperLangRef.current = lang.toLowerCase().startsWith("hi") ? "hi" : "en";

  const audioCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hasSpeechRef = useRef(false);
  const consecutiveAboveThresholdRef = useRef(0);
  const vadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finalizeAndDispatchRef = useRef<() => void>(() => {});

  const bargeInOnlyRef = useRef(false);
  const bargedInRef = useRef(false);

  const calibratingRef = useRef(false);
  const calibrationSamplesRef = useRef<number[]>([]);
  const speechThresholdRef = useRef(MIN_ABSOLUTE_THRESHOLD);
  const speechMsAccumulatedRef = useRef(0);

  const stopCapture = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (vadTimerRef.current) {
      clearTimeout(vadTimerRef.current);
      vadTimerRef.current = null;
    }
    hasSpeechRef.current = false;
    consecutiveAboveThresholdRef.current = 0;
    calibratingRef.current = false;
    calibrationSamplesRef.current = [];
    speechMsAccumulatedRef.current = 0;
    processorRef.current?.disconnect();
    processorRef.current = null;
    audioCtxRef.current?.close();
    audioCtxRef.current = null;
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setListening(false);
    setInterimText("");
    setMicLevel(0);
  }, []);

  const resetSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    silenceTimerRef.current = setTimeout(() => finalizeAndDispatchRef.current(), SILENCE_TIMEOUT_MS);
  }, []);

  const startListeningRef = useRef<(opts?: { bargeInOnly?: boolean }) => void>(() => {});

  const finalizeAndDispatch = useCallback(async () => {
    const wasBargeInOnly = bargeInOnlyRef.current;
    const didBargeIn = bargedInRef.current;
    const spokeLongEnough = speechMsAccumulatedRef.current >= MIN_SPEECH_MS_TO_DISPATCH;
    bargeInOnlyRef.current = false;
    bargedInRef.current = false;

    stopCapture();

    if ((wasBargeInOnly && !didBargeIn) || !spokeLongEnough) {
      if (wakeWordEnabledRef.current) {
        setTimeout(() => startListeningRef.current(), WAKE_RESTART_DELAY_MS);
      }
      return;
    }

    setTranscribing(true);

    let transcript = "";
    try {
      transcript = (await window.vsmart.voice.finalize(whisperLangRef.current))?.trim() ?? "";
    } catch {
      transcript = "";
    } finally {
      setTranscribing(false);
    }

    if (transcript) {
      const lower = transcript.toLowerCase();
      const wakeMatch = lower.match(WAKE_WORD_VARIANTS);
      const hasWakeWord = !!wakeMatch;
      const afterWake = hasWakeWord
        ? lower.slice((wakeMatch!.index ?? 0) + wakeMatch![0].length).trim()
        : transcript;

      console.log(
        `[Voice] heard: "${transcript}" | hasWakeWord=${hasWakeWord} | ` +
        `wakeMode=${wakeWordEnabledRef.current} | bargedIn=${didBargeIn} | ` +
        `threshold=${speechThresholdRef.current.toFixed(4)}`
      );

      if (hasWakeWord && !afterWake) {
        speak(`${timeBasedGreeting()} Boss, how can I help?`, lang);
      } else if (didBargeIn || hasWakeWord || !wakeWordEnabledRef.current) {
        onCommandRef.current(afterWake || transcript);
      }
    } else {
      console.log("[Voice] Whisper returned nothing usable for this turn.");
      if (!wakeWordEnabledRef.current) {
        speak(lang.startsWith("hi") ? "माफ़ कीजिए, ठीक से सुनाई नहीं दिया।" : "Sorry, I didn't catch that clearly.", lang);
      }
    }

    if (wakeWordEnabledRef.current) {
      setTimeout(() => startListeningRef.current(), WAKE_RESTART_DELAY_MS);
    }
  }, [lang, stopCapture]);

  finalizeAndDispatchRef.current = () => { void finalizeAndDispatch(); };

  useEffect(() => {
    if (!window.vsmart?.voice) {
      setSupported(false);
      setErrorMsg("Voice bridge not available.");
      return;
    }
    return () => {
      stopCapture();
    };
  }, [stopCapture]);

  const startListening = useCallback(async (opts?: { bargeInOnly?: boolean }) => {
    if (listening) return;

    const isBargeInAttempt = !!opts?.bargeInOnly;
    bargeInOnlyRef.current = isBargeInAttempt;
    bargedInRef.current = false;
    speechMsAccumulatedRef.current = 0;

    if (!isBargeInAttempt && isSpeaking()) {
      if (wakeWordEnabledRef.current) {
        setTimeout(() => startListeningRef.current(), 800);
      } else {
        setErrorMsg("Wait, I'm still talking...");
      }
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
          autoGainControl: false
        }
      });

      streamRef.current = stream;

      const audioCtx = new AudioContext({ sampleRate: SAMPLE_RATE });
      audioCtxRef.current = audioCtx;

      const source = audioCtx.createMediaStreamSource(stream);
      const processor = audioCtx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      calibratingRef.current = true;
      calibrationSamplesRef.current = [];
      speechThresholdRef.current = MIN_ABSOLUTE_THRESHOLD;
      const calibrationStartedAt = performance.now();
      const chunkMs = (4096 / SAMPLE_RATE) * 1000;

      processor.onaudioprocess = (e) => {
        const float32 = e.inputBuffer.getChannelData(0);
        const int16 = new Int16Array(float32.length);

        let sumSq = 0;
        for (let i = 0; i < float32.length; i++) {
          const s = Math.max(-1, Math.min(1, float32[i]));
          int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
          sumSq += s * s;
        }

        window.vsmart.voice.sendAudioChunk(int16.buffer);

        const rms = Math.sqrt(sumSq / float32.length);
        setMicLevel(Math.min(1, rms * 8));

        if (calibratingRef.current) {
          calibrationSamplesRef.current.push(rms);
          if (performance.now() - calibrationStartedAt >= CALIBRATION_MS) {
            calibratingRef.current = false;
            const samples = calibrationSamplesRef.current;
            const avgFloor = samples.length
              ? samples.reduce((a, b) => a + b, 0) / samples.length
              : 0;
            speechThresholdRef.current = Math.min(
              MAX_THRESHOLD_CAP,
              Math.max(MIN_ABSOLUTE_THRESHOLD, avgFloor * THRESHOLD_MULTIPLIER)
            );
            console.log(
              `[Voice] calibrated noise floor=${avgFloor.toFixed(4)} -> threshold=${speechThresholdRef.current.toFixed(4)}`
            );
          }
          return;
        }

        setInterimText(hasSpeechRef.current ? "Listening..." : "");

        if (rms > speechThresholdRef.current) {
          consecutiveAboveThresholdRef.current += 1;

          // Not enough sustained volume yet to trust this as real speech —
          // could still be a brief noise blip. Wait for a couple more
          // chunks before committing (this does NOT reset the VAD silence
          // timer, so a genuinely ongoing turn is unaffected).
          if (!hasSpeechRef.current && consecutiveAboveThresholdRef.current < SPEECH_CONFIRM_CHUNKS) {
            return;
          }

          const justStartedSpeaking = !hasSpeechRef.current;
          hasSpeechRef.current = true;
          speechMsAccumulatedRef.current += chunkMs;

          if (justStartedSpeaking && isSpeaking()) {
            cancelSpeech();
            bargedInRef.current = true;
          }

          if (vadTimerRef.current) {
            clearTimeout(vadTimerRef.current);
            vadTimerRef.current = null;
          }
        } else {
          consecutiveAboveThresholdRef.current = 0;

          if (hasSpeechRef.current && !vadTimerRef.current) {
            vadTimerRef.current = setTimeout(() => {
              vadTimerRef.current = null;
              finalizeAndDispatchRef.current();
            }, VAD_SILENCE_MS);
          }
        }
      };

      const silentGain = audioCtx.createGain();
      silentGain.gain.value = 0;

      source.connect(processor);
      processor.connect(silentGain);
      silentGain.connect(audioCtx.destination);

      window.vsmart.voice.reset();
      setListening(true);
      resetSilenceTimer();
    } catch (err) {
      bargeInOnlyRef.current = false;
      setErrorMsg(
        err instanceof Error && err.name === "NotAllowedError"
          ? "Microphone access denied. Please allow microphone permission."
          : "Could not access the microphone."
      );
    }
  }, [listening, resetSilenceTimer]);

  startListeningRef.current = startListening;

  const stopListening = useCallback(() => {
    stopCapture();
  }, [stopCapture]);

  const toggleListening = useCallback(() => {
    if (listening) stopListening();
    else startListening();
  }, [listening, startListening, stopListening]);

  useEffect(() => {
    if (wakeWordEnabled && !listening) {
      startListeningRef.current();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wakeWordEnabled]);

  useEffect(() => {
    registerSpeechStartListener(() => {
      if (!wakeWordEnabledRef.current && !listening) {
        startListeningRef.current({ bargeInOnly: true });
      }
    });
    return () => registerSpeechStartListener(null);
  }, [listening]);

  return {
    listening,
    transcribing,
    wakeActive: listening,
    interimText,
    supported,
    errorMsg,
    micLevel,
    startListening,
    stopListening,
    toggleListening
  };
}

// ---------- Speech output (TTS) ----------

let preferredVoiceName: string | null = null;
let preferredGender: "male" | "female" = "female";

export function setPreferredVoice(name: string | null) {
  preferredVoiceName = name;
}

export function getPreferredVoice(): string | null {
  return preferredVoiceName;
}

export function setPreferredGender(gender: "male" | "female") {
  preferredGender = gender;
}

let onSpeechStart: (() => void) | null = null;

function registerSpeechStartListener(cb: (() => void) | null) {
  onSpeechStart = cb;
}

let currentAudioEl: HTMLAudioElement | null = null;

/**
 * Speaks text out loud. Tries Microsoft Edge's natural neural voice first
 * (genuinely human-sounding Indian English/Hindi voice, needs internet);
 * if that's unavailable it falls back to the OS's built-in offline voice.
 */
export function speak(text: string, lang = "en-IN") {
  if (!text.trim()) return;

  window.speechSynthesis?.cancel();
  currentAudioEl?.pause();
  currentAudioEl = null;

  const shortLang: "en" | "hi" = lang.toLowerCase().startsWith("hi") ? "hi" : "en";

  if (window.vsmart?.tts?.synthesize) {
    window.vsmart.tts.synthesize(text, shortLang, preferredGender)
      .then((dataUrl) => {
        if (!dataUrl) {
          speakOffline(text, lang);
          return;
        }
        const audio = new Audio(dataUrl);
        currentAudioEl = audio;
        audio.onplay = () => onSpeechStart?.();
        audio.onerror = () => speakOffline(text, lang);
        audio.play().catch(() => speakOffline(text, lang));
      })
      .catch(() => speakOffline(text, lang));
  } else {
    speakOffline(text, lang);
  }
}

/** Interrupts whatever is currently speaking (natural or offline voice) — used for barge-in. */
export function cancelSpeech() {
  window.speechSynthesis?.cancel();
  currentAudioEl?.pause();
  currentAudioEl = null;
}

/** Whether VSmart is currently speaking, via either voice path. */
export function isSpeaking(): boolean {
  return !!window.speechSynthesis?.speaking || (!!currentAudioEl && !currentAudioEl.paused);
}

function speakOffline(text: string, lang: string) {
  if (!("speechSynthesis" in window)) return;

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang;
  utterance.rate = 1;

  utterance.onstart = () => {
    onSpeechStart?.();
  };

  const pickVoice = () => {
    const voices = window.speechSynthesis.getVoices();
    if (!voices.length) return;

    if (preferredVoiceName) {
      const chosen = voices.find(v => v.name === preferredVoiceName);
      if (chosen) {
        utterance.voice = chosen;
        utterance.lang = chosen.lang;
        return;
      }
    }

    const naturalNames = ["neerja", "swara"];
    const legacyFemaleNames = ["heera", "priya", "kalpana", "veena", "raveena", "indian female"];

    const naturalVoice =
      voices.find(v => naturalNames.some(n => v.name.toLowerCase().includes(n)) &&
        (v.lang?.toLowerCase() === "en-in" || v.lang?.toLowerCase() === "hi-in"));

    const legacyVoice =
      voices.find(v => v.lang?.toLowerCase() === "en-in" && legacyFemaleNames.some(n => v.name.toLowerCase().includes(n))) ||
      voices.find(v => v.lang?.toLowerCase() === "en-in" && v.name.toLowerCase().includes("female")) ||
      voices.find(v => v.lang?.toLowerCase() === "en-in") ||
      voices.find(v => v.lang?.toLowerCase() === "hi-in");

    const chosen = naturalVoice ?? legacyVoice;
    if (chosen) {
      utterance.voice = chosen;
      utterance.lang = chosen.lang;
    }
  };

  if (window.speechSynthesis.getVoices().length) {
    pickVoice();
  } else {
    window.speechSynthesis.onvoiceschanged = pickVoice;
  }

  window.speechSynthesis.speak(utterance);
}