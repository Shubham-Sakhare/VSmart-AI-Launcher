import { useEffect, useRef, useState } from "react";
import { Send, Mic, Sparkles, User, Eye, Loader2 } from "lucide-react";
import type { Message } from "../layout/MainLayout";
import type { VoiceControls } from "../../voice/useVoice";
import "./ChatPanel.css";

interface ChatPanelProps {
  messages: Message[];
  onSend: (text: string) => void;
  voice: VoiceControls;
}

function formatTime() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function ChatPanel({ messages, onSend, voice }: ChatPanelProps) {
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSend = () => {
    const text = input.trim();
    if (!text) return;
    onSend(text);
    setInput("");
    inputRef.current?.focus();
  };

  // Auto-scroll to bottom whenever messages, voice status, or interim text change.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, voice.interimText, voice.transcribing]);

  // Derive a single status string shown in the header badge.
  const statusLabel = voice.transcribing
    ? "processing…"
    : voice.listening
    ? "listening…"
    : null;

  return (
    <div className="chat-panel">

      {/* Header */}
      <div className="chat-header">
        <div className="chat-header-title">
          <Sparkles size={16} />
          <span>VSmart Voice AI</span>
        </div>
        {statusLabel && (
          <span className="chat-header-status">
            {voice.transcribing && <Loader2 size={12} className="spin" />}
            {statusLabel}
          </span>
        )}
      </div>

      {/* Message list */}
      <div className="messages">

        {messages.length === 0 && !voice.listening && !voice.transcribing && (
          <div className="empty-state">
            <Sparkles size={22} />
            <p>Say something or type a message to get started.</p>
          </div>
        )}

        {messages.map((msg, index) => {
          const isUser = msg.sender === "You";
          return (
            <div key={index} className={isUser ? "msg-row user" : "msg-row ai"}>
              {!isUser && (
                <div className="avatar ai-avatar">
                  <Sparkles size={14} />
                </div>
              )}
              <div className="bubble">
                <p>{msg.text}</p>
                <span className="bubble-time">{formatTime()}</span>
              </div>
              {isUser && (
                <div className="avatar user-avatar">
                  <User size={14} />
                </div>
              )}
            </div>
          );
        })}

        {/* Live "Listening…" bubble — shown while mic is active and speech detected */}
        {voice.listening && voice.interimText && (
          <div className="msg-row user">
            <div className="bubble bubble-interim">
              <span className="interim-dot" /><span className="interim-dot" /><span className="interim-dot" />
              <p>{voice.interimText}</p>
            </div>
            <div className="avatar user-avatar">
              <User size={14} />
            </div>
          </div>
        )}

        {/* "Transcribing…" bubble — shown while Whisper is processing audio */}
        {voice.transcribing && (
          <div className="msg-row user">
            <div className="bubble bubble-interim bubble-transcribing">
              <Loader2 size={13} className="spin" />
              <p>Transcribing…</p>
            </div>
            <div className="avatar user-avatar">
              <User size={14} />
            </div>
          </div>
        )}

        {voice.errorMsg && (
          <div className="voice-error">⚠️ {voice.errorMsg}</div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input row */}
      <div className="chat-input">
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Message VSmart..."
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSend();
          }}
        />

        <button
          onClick={() => onSend("what's on my screen")}
          className="icon-btn vision-btn"
          title="Screen Vision — let VSmart see your screen"
        >
          <Eye size={17} />
        </button>

        {voice.supported && (
          <button
            onClick={voice.toggleListening}
            className={
              voice.listening
                ? "icon-btn mic-btn listening"
                : voice.transcribing
                ? "icon-btn mic-btn transcribing"
                : "icon-btn mic-btn"
            }
            title={
              voice.listening
                ? "Listening — click to stop"
                : voice.transcribing
                ? "Processing…"
                : "Speak a command"
            }
            disabled={voice.transcribing}
            aria-label={voice.listening ? "Stop voice input" : "Start voice input"}
          >
            {/* Always show Mic icon — pulsing animation communicates "active".
                MicOff only appears while idle to signal "click to start". */}
            <Mic size={17} />
          </button>
        )}

        <button
          className="icon-btn send-btn"
          onClick={handleSend}
          disabled={!input.trim()}
          title="Send"
        >
          <Send size={17} />
        </button>
      </div>

    </div>
  );
}
