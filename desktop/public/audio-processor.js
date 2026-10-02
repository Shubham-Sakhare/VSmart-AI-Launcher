/**
 * VSmart AI — Audio Capture Worklet
 *
 * Runs in the AudioWorklet thread (off the main JS thread).
 * Converts Float32 PCM → Int16 PCM and posts each chunk back to the
 * main thread for IPC forwarding to the Whisper transcription service.
 *
 * Also computes per-chunk RMS so the main thread can drive the mic-level
 * meter and VAD threshold calibration without re-iterating the samples.
 */

class VSmartCaptureProcessor extends AudioWorkletProcessor {
  // AudioWorkletProcessor.process() receives 128-sample frames at a time.
  // We accumulate them until we have enough for a ~256ms chunk (4096 samples
  // at 16 kHz) — matching the old ScriptProcessorNode buffer size so the
  // rest of the VAD logic doesn't need to change.
  static get parameterDescriptors() { return []; }

  constructor() {
    super();
    this._buf = new Float32Array(4096);
    this._pos = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true; // keep alive

    const samples = input[0]; // 128 Float32 samples

    for (let i = 0; i < samples.length; i++) {
      this._buf[this._pos++] = samples[i];

      if (this._pos >= 4096) {
        // Convert Float32 → Int16 and compute RMS in one pass
        const int16 = new Int16Array(4096);
        let sumSq = 0;
        for (let j = 0; j < 4096; j++) {
          const s = Math.max(-1, Math.min(1, this._buf[j]));
          int16[j] = s < 0 ? (s * 0x8000) | 0 : (s * 0x7fff) | 0;
          sumSq += s * s;
        }
        const rms = Math.sqrt(sumSq / 4096);

        // Transfer the Int16Array buffer to avoid a copy
        this.port.postMessage({ int16: int16.buffer, rms }, [int16.buffer]);
        this._pos = 0;
      }
    }

    return true; // keep processor alive
  }
}

registerProcessor("vsmart-capture", VSmartCaptureProcessor);
