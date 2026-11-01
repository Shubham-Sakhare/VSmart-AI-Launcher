// ═══════════════════════════════════════════════════════════════════════════
// JARVIS/IRIS - AI Core Orb (Animated Avatar)
//
// Shows the AI's current state as an animated orb:
//   IDLE      → slow breathing pulse
//   LISTENING → green ripple rings
//   THINKING  → rotating arcs
//   PLANNING  → data flow particles
//   EXECUTING → active pulsing
//   SPEAKING  → audio wave
//   ERROR     → red dim pulse
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useRef } from "react";
import type { AssistantState } from "../../../store/appStore";
import "./JarvisOrb.css";

interface JarvisOrbProps {
  state:      AssistantState;
  micLevel?:  number;   // 0-1 from VAD
  size?:      number;   // px
  onClick?:   () => void;
}

// State → visual config
const STATE_CONFIG: Record<AssistantState, {
  color:    string;
  glow:     string;
  label:    string;
  animate:  string;
}> = {
  IDLE:       { color: "#00d4ff", glow: "rgba(0,212,255,0.25)", label: "Ready",     animate: "orb-idle"      },
  LISTENING:  { color: "#00ff88", glow: "rgba(0,255,136,0.40)", label: "Listening", animate: "orb-listening" },
  THINKING:   { color: "#ff9500", glow: "rgba(255,149,0,0.40)", label: "Thinking",  animate: "orb-thinking"  },
  PLANNING:   { color: "#b44fff", glow: "rgba(180,79,255,0.40)",label: "Planning",  animate: "orb-planning"  },
  EXECUTING:  { color: "#ffdc00", glow: "rgba(255,220,0,0.40)", label: "Executing", animate: "orb-executing" },
  SPEAKING:   { color: "#00d4ff", glow: "rgba(0,212,255,0.50)", label: "Speaking",  animate: "orb-speaking"  },
  COMPLETED:  { color: "#00ff88", glow: "rgba(0,255,136,0.35)", label: "Done",      animate: "orb-completed" },
  ERROR:      { color: "#ff3b30", glow: "rgba(255,59,48,0.40)", label: "Error",     animate: "orb-error"     },
};

export default function JarvisOrb({ state, micLevel = 0, size = 120, onClick }: JarvisOrbProps) {
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const micRingRef = useRef<HTMLDivElement>(null);
  const frameRef   = useRef(0);
  const angleRef   = useRef(0);

  const cfg = STATE_CONFIG[state] ?? STATE_CONFIG.IDLE;

  // ── Mic level ring (shows voice activity visually) ────────────────────────
  useEffect(() => {
    const ring = micRingRef.current;
    if (!ring) return;
    if (state === "LISTENING" && micLevel > 0.05) {
      const scale = 1 + micLevel * 0.7;
      ring.style.width   = `${size * scale}px`;
      ring.style.height  = `${size * scale}px`;
      ring.style.opacity = String(Math.min(0.9, micLevel * 2));
    } else {
      ring.style.opacity = "0";
    }
  }, [micLevel, state, size]);

  // ── Canvas wave animation for SPEAKING and LISTENING ─────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const r = size / 2;
    canvas.width  = size;
    canvas.height = size;

    const draw = () => {
      ctx.clearRect(0, 0, size, size);
      angleRef.current += 0.04;
      const a = angleRef.current;

      if (state === "LISTENING" || state === "SPEAKING") {
        const waveAmp = state === "LISTENING" ? (micLevel * 12 + 3) : 6;
        const waves   = 3;
        for (let w = 0; w < waves; w++) {
          ctx.beginPath();
          ctx.strokeStyle = `rgba(${hexToRgb(cfg.color)},${0.6 - w * 0.15})`;
          ctx.lineWidth   = 1.5;
          for (let x = 0; x < size; x++) {
            const phase = a + (w * Math.PI * 2) / waves;
            const y = r + Math.sin((x / size) * Math.PI * 4 + phase) * waveAmp * (1 - w * 0.2);
            x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
          }
          ctx.stroke();
        }
      }

      if (state === "THINKING" || state === "PLANNING") {
        // Rotating arc segments
        const arcs = state === "THINKING" ? 3 : 5;
        for (let i = 0; i < arcs; i++) {
          const start = a + (i / arcs) * Math.PI * 2;
          const end   = start + Math.PI * 0.5;
          ctx.beginPath();
          ctx.arc(r, r, r * 0.6 + i * 4, start, end);
          ctx.strokeStyle = `rgba(${hexToRgb(cfg.color)},${0.9 - i * 0.15})`;
          ctx.lineWidth   = 2;
          ctx.stroke();
        }
      }

      if (state === "EXECUTING") {
        // Expanding rings
        for (let i = 0; i < 3; i++) {
          const rad = (r * 0.4) + ((a * 30 + i * 15) % (r * 0.55));
          const alpha = 0.7 - rad / r;
          ctx.beginPath();
          ctx.arc(r, r, rad, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(${hexToRgb(cfg.color)},${Math.max(0, alpha)})`;
          ctx.lineWidth   = 1.5;
          ctx.stroke();
        }
      }

      frameRef.current = requestAnimationFrame(draw);
    };

    frameRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frameRef.current);
  }, [state, micLevel, size, cfg.color]);

  return (
    <div
      className={`jarvis-orb ${cfg.animate}`}
      style={{
        width:  size,
        height: size,
        "--orb-color": cfg.color,
        "--orb-glow":  cfg.glow,
        cursor: onClick ? "pointer" : "default",
      } as React.CSSProperties}
      onClick={onClick}
      title={cfg.label}
      role="button"
      aria-label={`AI Assistant — ${cfg.label}`}
    >
      {/* Mic level ring — grows with voice input */}
      <div
        ref={micRingRef}
        className="orb-mic-ring"
        style={{ width: size, height: size }}
      />

      {/* Outer glow ring */}
      <div className="orb-ring orb-ring-outer" />
      <div className="orb-ring orb-ring-mid"   />

      {/* Core sphere */}
      <div className="orb-core">
        {/* Canvas for dynamic wave/arc overlay */}
        <canvas ref={canvasRef} className="orb-canvas" />

        {/* VSmart icon */}
        <div className="orb-inner-icon">
          <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="20" cy="20" r="8" stroke="currentColor" strokeWidth="1.5" opacity="0.9"/>
            <circle cx="20" cy="20" r="3" fill="currentColor" opacity="0.8"/>
            <line x1="20" y1="4"  x2="20" y2="10" stroke="currentColor" strokeWidth="1.2" opacity="0.6"/>
            <line x1="20" y1="30" x2="20" y2="36" stroke="currentColor" strokeWidth="1.2" opacity="0.6"/>
            <line x1="4"  y1="20" x2="10" y2="20" stroke="currentColor" strokeWidth="1.2" opacity="0.6"/>
            <line x1="30" y1="20" x2="36" y2="20" stroke="currentColor" strokeWidth="1.2" opacity="0.6"/>
          </svg>
        </div>
      </div>

      {/* State label */}
      <div className="orb-label">{cfg.label}</div>
    </div>
  );
}

// ── Helper ────────────────────────────────────────────────────────────────────
function hexToRgb(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r},${g},${b}`;
}
