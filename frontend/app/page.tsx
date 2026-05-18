"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  Loader2,
  Mic,
  Send,
  Settings2,
  Sparkles,
  Square,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

const REMOTE_BACKEND_URL = "https://voice-assistent-lsuc.onrender.com";

const HERO_VIDEO_URL =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260405_170732_8a9ccda6-5cff-4628-b164-059c500a2b41.mp4";

const SPEECH_LANGUAGES = [
  { code: "en-US", label: "English" },
  { code: "hi-IN", label: "Hindi" },
  { code: "bn-IN", label: "Bengali" },
  { code: "ta-IN", label: "Tamil" },
  { code: "te-IN", label: "Telugu" },
  { code: "mr-IN", label: "Marathi" },
  { code: "gu-IN", label: "Gujarati" },
  { code: "kn-IN", label: "Kannada" },
  { code: "ml-IN", label: "Malayalam" },
  { code: "pa-IN", label: "Punjabi" },
  { code: "ur-IN", label: "Urdu" },
];

const VOICE_STYLES = [
  { value: "auto", label: "Default" },
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
] as const;

type VoiceStyle = (typeof VOICE_STYLES)[number]["value"];

type SpeechRecognitionConstructor = new () => SpeechRecognition;

type SpeechRecognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onresult:
    | ((event: {
        resultIndex: number;
        results: {
          length: number;
          [index: number]: {
            isFinal: boolean;
            [index: number]: { transcript: string };
          };
        };
      }) => void)
    | null;
};

type Particle = {
  id: number;
  x: number;
  y: number;
  size: number;
  opacity: number;
  duration: number;
};

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

export default function Page() {
  const [backendUrl, setBackendUrl] = useState(getDefaultBackendUrl);
  const [language, setLanguage] = useState("en-US");
  const [status, setStatus] = useState("Ready");
  const [transcript, setTranscript] = useState("");
  const [reply, setReply] = useState("");
  const [typedMessage, setTypedMessage] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [voiceStyle, setVoiceStyle] = useState<VoiceStyle>("auto");
  const [waveformData, setWaveformData] = useState<number[]>(Array(32).fill(6));
  const [volume, setVolume] = useState(0);
  const [duration, setDuration] = useState(0);

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const runningRef = useRef(false);
  const speakingRef = useRef(false);
  const busyRef = useRef(false);
  const restartTimerRef = useRef<number | null>(null);
  const silenceTimerRef = useRef<number | null>(null);
  const latestHeardRef = useRef("");
  const lastHandledRef = useRef("");

  const particles = useMemo<Particle[]>(
    () =>
      Array.from({ length: 22 }, (_, index) => ({
        id: index,
        x: (index * 43) % 390,
        y: (index * 71) % 390,
        size: 1 + (index % 4),
        opacity: 0.14 + (index % 5) * 0.04,
        duration: 3 + (index % 6) * 0.35,
      })),
    [],
  );

  useEffect(() => {
    if (!isRunning && !isSpeaking && !isThinking) {
      setWaveformData(Array(32).fill(6));
      setVolume(0);
      return;
    }

    const interval = window.setInterval(() => {
      const intensity = isSpeaking ? 76 : isThinking ? 42 : 96;
      const newWaveform = Array.from({ length: 32 }, (_, index) => {
        const rhythm = Math.abs(Math.sin(Date.now() / 180 + index * 0.7));
        return 6 + rhythm * intensity * (0.45 + ((index % 5) * 0.1));
      });
      const newVolume = Math.min(100, Math.round(Math.max(...newWaveform)));
      setWaveformData(newWaveform);
      setVolume(newVolume);
      if (isRunning) {
        setDuration((previous) => previous + 1);
      }
    }, 180);

    return () => window.clearInterval(interval);
  }, [isRunning, isSpeaking, isThinking]);

  function startConversation() {
    if (runningRef.current) return;

    const SpeechRecognitionApi =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognitionApi) {
      setStatus("Use Chrome or Edge for browser voice recognition.");
      return;
    }

    runningRef.current = true;
    setIsRunning(true);
    setDuration(0);
    setStatus("Listening...");

    const recognition = new SpeechRecognitionApi();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = language;

    recognition.onstart = () => {
      if (!speakingRef.current) {
        setStatus("Listening...");
      }
    };

    recognition.onerror = (event) => {
      if (event.error !== "aborted") {
        setStatus(`Mic error: ${event.error}`);
      }
    };

    recognition.onend = () => {
      if (runningRef.current) {
        restartTimerRef.current = window.setTimeout(() => {
          try {
            recognition.start();
          } catch {
            // Browser can throw if recognition is already starting.
          }
        }, 250);
      }
    };

    recognition.onresult = (event) => {
      let interim = "";
      let finalText = "";

      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const text = event.results[index][0].transcript.trim();
        if (event.results[index].isFinal) {
          finalText += ` ${text}`;
        } else {
          interim += ` ${text}`;
        }
      }

      const heard = (finalText || interim).trim();
      if (!heard) return;

      latestHeardRef.current = heard;
      setTranscript(heard);
      clearSilenceTimer();

      if (speakingRef.current && heard.split(/\s+/).length >= 2) {
        window.speechSynthesis.cancel();
        speakingRef.current = false;
        setIsSpeaking(false);
        setStatus("Interrupted. Thinking...");
        void handleUserText(heard);
        return;
      }

      if (finalText.trim()) {
        void handleUserText(finalText.trim());
      } else if (!speakingRef.current) {
        silenceTimerRef.current = window.setTimeout(() => {
          void handleUserText(latestHeardRef.current);
        }, 900);
      }
    };

    recognitionRef.current = recognition;
    recognition.start();
  }

  function stopConversation() {
    runningRef.current = false;
    speakingRef.current = false;
    busyRef.current = false;

    if (restartTimerRef.current) {
      window.clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    clearSilenceTimer();

    recognitionRef.current?.abort();
    recognitionRef.current = null;
    window.speechSynthesis.cancel();

    setIsRunning(false);
    setIsSpeaking(false);
    setIsThinking(false);
    setDuration(0);
    setStatus("Stopped");
  }

  async function handleUserText(text: string) {
    const cleanText = text.trim();
    if (!cleanText || busyRef.current) return;

    if (cleanText.toLowerCase() === lastHandledRef.current.toLowerCase()) {
      return;
    }

    lastHandledRef.current = cleanText;
    busyRef.current = true;
    setTranscript(cleanText);
    setIsThinking(true);
    setStatus("Thinking...");

    try {
      const response = await fetch(`${backendUrl}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: cleanText }),
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      const data = (await response.json()) as { reply: string };
      setReply(data.reply);
      busyRef.current = false;
      setIsThinking(false);
      await speak(data.reply);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Request failed");
      busyRef.current = false;
      setIsThinking(false);
    }
  }

  function clearSilenceTimer() {
    if (silenceTimerRef.current) {
      window.clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }

  function speak(text: string) {
    return speakWithBackendTts(text);
  }

  async function speakWithBackendTts(text: string) {
    speakingRef.current = true;
    setIsSpeaking(true);
    setStatus("Generating backend voice...");
    let playedAudio = false;
    let failedMessage = "";
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetch(`${backendUrl}/speak`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          message: text,
          language,
          voice_style: voiceStyle,
        }),
      });

      if (!response.ok) {
        const message = await readErrorMessage(response);
        throw new Error(message);
      } else {
        const audioBlob = await response.blob();
        if (audioBlob.size === 0) {
          throw new Error("Backend returned an empty audio file.");
        }

        const audioUrl = URL.createObjectURL(audioBlob);
        const audio = new Audio(audioUrl);
        audio.volume = 1;

        setStatus("Speaking... talk to interrupt");
        try {
          await playAudio(audio);
          playedAudio = true;
        } finally {
          URL.revokeObjectURL(audioUrl);
        }
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        failedMessage = "Backend voice timed out after 30s.";
      } else {
        failedMessage = error instanceof Error ? error.message : "Backend audio failed.";
      }
    } finally {
      window.clearTimeout(timeoutId);
      speakingRef.current = false;
      setIsSpeaking(false);

      if (failedMessage) {
        setStatus(`Backend voice failed: ${failedMessage}`);
      } else if (playedAudio && runningRef.current) {
        setStatus("Listening...");
      } else if (playedAudio) {
        setStatus("Ready");
      }
    }
  }

  const activeMode = isThinking
    ? "processing"
    : isSpeaking
      ? "speaking"
      : isRunning
        ? "listening"
        : "idle";

  return (
    <main className="min-h-screen bg-black p-2 text-[#E1E0CC] sm:p-3">
      <section className="relative min-h-[calc(100vh-1rem)] overflow-hidden rounded-2xl sm:min-h-[calc(100vh-1.5rem)] md:rounded-[2rem]">
        <video
          autoPlay
          loop
          muted
          playsInline
          className="absolute inset-0 h-full w-full object-cover"
          src={HERO_VIDEO_URL}
        />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(8,16,32,0.08),rgba(0,0,0,0.78))]" />
        <div className="noise-overlay pointer-events-none absolute inset-0 opacity-60 mix-blend-overlay" />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/35 via-black/5 to-black/75" />

        <nav className="absolute left-1/2 top-0 z-20 -translate-x-1/2">
          <div className="flex items-center gap-4 rounded-b-2xl bg-black/90 px-5 py-2 text-[11px] text-[#E1E0CC]/75 backdrop-blur md:gap-8 md:rounded-b-3xl md:px-8 md:text-sm">
            <span>Voice</span>
            <span>AI</span>
            <span>Languages</span>
            <span>Assistant</span>
          </div>
        </nav>

        <div className="relative z-10 mx-auto flex min-h-[calc(100vh-1rem)] w-full max-w-7xl flex-col px-4 pb-5 pt-14 sm:min-h-[calc(100vh-1.5rem)] sm:px-6 md:px-8 lg:pt-12">
          <div className="grid flex-1 grid-cols-1 gap-4 lg:grid-cols-[minmax(240px,320px)_minmax(360px,1fr)_minmax(240px,320px)] lg:items-center">
            <aside className="order-2 rounded-lg border border-white/12 bg-black/45 p-4 shadow-2xl backdrop-blur-md lg:order-1">
              <div className="flex items-center gap-2 text-sm font-medium text-[#E1E0CC]/80">
                <Settings2 className="h-4 w-4" />
                Controls
              </div>

              <label className="mt-5 block text-xs uppercase tracking-[0.18em] text-[#E1E0CC]/55" htmlFor="backend-url">
                Backend URL
              </label>
              <input
                id="backend-url"
                className="mt-2 w-full rounded-md border border-white/12 bg-black/55 px-3 py-2 text-sm text-[#E1E0CC] outline-none transition focus:border-cyan-300"
                value={backendUrl}
                onChange={(event) => setBackendUrl(event.target.value)}
              />

              <label className="mt-4 block text-xs uppercase tracking-[0.18em] text-[#E1E0CC]/55" htmlFor="language">
                Browser speech language
              </label>
              <select
                id="language"
                className="mt-2 w-full rounded-md border border-white/12 bg-black/55 px-3 py-2 text-sm text-[#E1E0CC] outline-none transition focus:border-cyan-300"
                value={language}
                onChange={(event) => setLanguage(event.target.value)}
                disabled={isRunning}
              >
                {SPEECH_LANGUAGES.map((speechLanguage) => (
                  <option key={speechLanguage.code} value={speechLanguage.code}>
                    {speechLanguage.label}
                  </option>
                ))}
              </select>

              <label className="mt-4 block text-xs uppercase tracking-[0.18em] text-[#E1E0CC]/55" htmlFor="voice-style">
                Voice model
              </label>
              <select
                id="voice-style"
                className="mt-2 w-full rounded-md border border-white/12 bg-black/55 px-3 py-2 text-sm text-[#E1E0CC] outline-none transition focus:border-cyan-300"
                value={voiceStyle}
                onChange={(event) => setVoiceStyle(event.target.value as VoiceStyle)}
              >
                {VOICE_STYLES.map((style) => (
                  <option key={style.value} value={style.value}>
                    {style.label}
                  </option>
                ))}
              </select>

              <p className="mt-4 rounded-md border border-cyan-300/20 bg-cyan-300/10 px-3 py-2 text-sm text-cyan-100">
                Output voice: backend neural TTS only
              </p>

              <div className="mt-5 flex gap-2">
                <input
                  id="typed-message"
                  className="min-w-0 flex-1 rounded-md border border-white/12 bg-black/55 px-3 py-2 text-sm text-[#E1E0CC] outline-none transition placeholder:text-[#E1E0CC]/35 focus:border-cyan-300"
                  value={typedMessage}
                  onChange={(event) => setTypedMessage(event.target.value)}
                  placeholder="Type a message"
                />
                <button
                  className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-[#E1E0CC] text-black transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={!typedMessage.trim()}
                  onClick={() => void handleUserText(typedMessage)}
                  aria-label="Send message"
                >
                  <Send className="h-4 w-4" />
                </button>
              </div>
            </aside>

            <section className="order-1 flex min-h-[470px] flex-col items-center justify-center text-center lg:order-2 lg:min-h-0">
              <motion.div
                initial={{ y: 18, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
                className="mb-5 lg:mb-6"
              >
                <p className="text-sm font-medium text-cyan-200"></p>
                <h1 className="mt-2 max-w-[92vw] text-4xl font-semibold leading-none tracking-normal text-[#E1E0CC] sm:text-6xl lg:text-7xl xl:text-8xl">
                  Voice Assistant
                </h1>
              </motion.div>

              <div className="relative flex h-[340px] w-full max-w-[500px] items-center justify-center overflow-hidden lg:h-[390px]">
                {particles.map((particle) => (
                  <motion.div
                    key={particle.id}
                    className="absolute rounded-full bg-cyan-100/35"
                    style={{
                      left: particle.x,
                      top: particle.y,
                      height: particle.size,
                      width: particle.size,
                      opacity: particle.opacity,
                    }}
                    animate={{
                      x: [0, 12, -8, 0],
                      y: [0, -10, 10, 0],
                      scale: [1, 1.6, 1],
                    }}
                    transition={{
                      duration: particle.duration,
                      repeat: Infinity,
                      ease: "easeInOut",
                    }}
                  />
                ))}

                <div className="relative z-10 flex flex-col items-center space-y-5 lg:space-y-6">
                  <motion.button
                    onClick={isRunning ? stopConversation : startConversation}
                    className={`relative flex h-28 w-28 items-center justify-center rounded-full border-2 bg-white/10 transition-all duration-300 sm:h-32 sm:w-32 ${
                      activeMode === "listening"
                        ? "border-blue-400 shadow-lg shadow-blue-500/30"
                        : activeMode === "processing"
                          ? "border-yellow-300 shadow-lg shadow-yellow-400/25"
                          : activeMode === "speaking"
                            ? "border-emerald-300 shadow-lg shadow-emerald-400/25"
                            : "border-white/25 hover:border-cyan-200"
                    }`}
                    whileHover={{ scale: 1.04 }}
                    whileTap={{ scale: 0.96 }}
                    animate={{
                      boxShadow:
                        activeMode === "listening"
                          ? [
                              "0 0 0 0 rgba(96, 165, 250, 0.36)",
                              "0 0 0 22px rgba(96, 165, 250, 0)",
                            ]
                          : undefined,
                    }}
                    transition={{
                      duration: 1.5,
                      repeat: activeMode === "listening" ? Infinity : 0,
                    }}
                    aria-label={isRunning ? "Stop conversation" : "Start conversation"}
                  >
                    <AnimatePresence mode="wait">
                      {activeMode === "processing" ? (
                        <motion.span
                          key="processing"
                          initial={{ opacity: 0, scale: 0.8 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.8 }}
                        >
                          <Loader2 className="h-12 w-12 animate-spin text-yellow-300" />
                        </motion.span>
                      ) : activeMode === "speaking" ? (
                        <motion.span
                          key="speaking"
                          initial={{ opacity: 0, scale: 0.8 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.8 }}
                        >
                          <Volume2 className="h-12 w-12 text-emerald-300" />
                        </motion.span>
                      ) : activeMode === "listening" ? (
                        <motion.span
                          key="listening"
                          initial={{ opacity: 0, scale: 0.8 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.8 }}
                        >
                          <Square className="h-11 w-11 fill-blue-300 text-blue-300" />
                        </motion.span>
                      ) : (
                        <motion.span
                          key="idle"
                          initial={{ opacity: 0, scale: 0.8 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.8 }}
                        >
                          <Mic className="h-12 w-12 text-[#E1E0CC]/75" />
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </motion.button>

                  <div className="flex h-12 items-center justify-center gap-1 sm:h-14">
                    {waveformData.map((height, index) => (
                      <motion.div
                        key={index}
                        className={`w-1 rounded-full ${
                          activeMode === "listening"
                            ? "bg-blue-300"
                            : activeMode === "processing"
                              ? "bg-yellow-300"
                              : activeMode === "speaking"
                                ? "bg-emerald-300"
                                : "bg-white/30"
                        }`}
                        animate={{
                          height: `${Math.max(5, height * 0.55)}px`,
                          opacity: activeMode === "idle" ? 0.3 : 1,
                        }}
                        transition={{ duration: 0.12, ease: "easeOut" }}
                      />
                    ))}
                  </div>

                  <div className="space-y-2 text-center">
                    <motion.p
                      className={`text-lg font-medium ${
                        activeMode === "listening"
                          ? "text-blue-300"
                          : activeMode === "processing"
                            ? "text-yellow-300"
                            : activeMode === "speaking"
                              ? "text-emerald-300"
                              : "text-[#E1E0CC]/75"
                      }`}
                      animate={{ opacity: activeMode === "idle" ? 1 : [1, 0.65, 1] }}
                      transition={{
                        duration: 2,
                        repeat: activeMode === "idle" ? 0 : Infinity,
                      }}
                    >
                      {status}
                    </motion.p>
                    <p className="font-mono text-sm text-[#E1E0CC]/55">
                      {formatTime(Math.floor(duration / 5))}
                    </p>

                    {volume > 0 && (
                      <motion.div
                        className="flex items-center justify-center gap-2"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                      >
                        <VolumeX className="h-4 w-4 text-[#E1E0CC]/50" />
                        <div className="h-2 w-24 overflow-hidden rounded-full bg-white/15">
                          <motion.div
                            className="h-full rounded-full bg-blue-300"
                            animate={{ width: `${volume}%` }}
                            transition={{ duration: 0.1 }}
                          />
                        </div>
                        <Volume2 className="h-4 w-4 text-[#E1E0CC]/50" />
                      </motion.div>
                    )}
                  </div>

                  <motion.div
                    className="flex items-center gap-2 text-sm text-[#E1E0CC]/60"
                    animate={{ opacity: [0.5, 1, 0.5] }}
                    transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
                  >
                    <Sparkles className="h-4 w-4" />
                    <span>AI Voice Assistant</span>
                  </motion.div>
                </div>
              </div>
            </section>

            <aside className="order-3 rounded-lg border border-white/12 bg-black/45 p-4 shadow-2xl backdrop-blur-md">
              <p className="text-xs uppercase tracking-[0.18em] text-[#E1E0CC]/55">You said</p>
              <p className="mt-2 min-h-28 rounded-md border border-white/10 bg-black/45 p-3 text-sm leading-7 text-[#E1E0CC]/85">
                {transcript || "No speech captured yet."}
              </p>

              <p className="mt-5 text-xs uppercase tracking-[0.18em] text-[#E1E0CC]/55">Assistant</p>
              <p className="mt-2 min-h-36 rounded-md border border-white/10 bg-black/45 p-3 text-sm leading-7 text-[#E1E0CC]/85">
                {reply || "No reply yet."}
              </p>

              <p className="mt-4 text-xs leading-5 text-[#E1E0CC]/45">
                running: {isRunning ? "yes" : "no"} | speaking: {isSpeaking ? "yes" : "no"} | interrupt:
                speak over AI
              </p>
            </aside>
          </div>
        </div>
      </section>
    </main>
  );
}

function formatTime(seconds: number) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

function getDefaultBackendUrl() {
  if (process.env.NEXT_PUBLIC_BACKEND_URL) {
    return process.env.NEXT_PUBLIC_BACKEND_URL;
  }

  if (
    typeof window !== "undefined" &&
    ["localhost", "127.0.0.1"].includes(window.location.hostname)
  ) {
    return "http://127.0.0.1:8000";
  }

  return REMOTE_BACKEND_URL;
}

async function playAudio(audio: HTMLAudioElement) {
  const ended = new Promise<void>((resolve, reject) => {
    audio.onended = () => resolve();
    audio.onerror = () => reject(new Error("Browser could not play backend audio."));
  });
  await audio.play();
  await ended;
}

async function readErrorMessage(response: Response) {
  const fallback = `Request failed with ${response.status}`;

  try {
    const data = (await response.json()) as { detail?: string };
    return data.detail || fallback;
  } catch {
    return fallback;
  }
}
