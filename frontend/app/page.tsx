"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  Mic,
  Send,
  Settings2,
  Sparkles,
  Square,
  VolumeX,
  Volume2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

const REMOTE_BACKEND_URL = "https://voice-assistent-lsuc.onrender.com";

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
  { value: "auto", label: "Auto agent" },
  { value: "hi-IN-SwaraNeural", label: "Hindi agent - Swara" },
  { value: "hi-IN-MadhurNeural", label: "Hindi agent - Madhur" },
  { value: "en-IN-NeerjaNeural", label: "English agent - Neerja" },
  { value: "en-IN-PrabhatNeural", label: "English agent - Prabhat" },
  { value: "female", label: "Female by language" },
  { value: "male", label: "Male by language" },
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

type ActiveMode = "idle" | "listening" | "processing" | "speaking";

type OrbitalNode = {
  id: number;
  angle: number;
  radius: number;
  size: number;
  opacity: number;
};

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
    webkitAudioContext?: typeof AudioContext;
  }
}

export default function Page() {
  const [backendUrl, setBackendUrl] = useState(getDefaultBackendUrl);
  const [language, setLanguage] = useState("hi-IN");
  const [status, setStatus] = useState("Ready");
  const [transcript, setTranscript] = useState("");
  const [reply, setReply] = useState("");
  const [typedMessage, setTypedMessage] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [voiceStyle, setVoiceStyle] = useState<VoiceStyle>("auto");
  const [allowBargeIn, setAllowBargeIn] = useState(true);
  const [waveformData, setWaveformData] = useState<number[]>(Array(32).fill(6));
  const [volume, setVolume] = useState(0);
  const [duration, setDuration] = useState(0);

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const runningRef = useRef(false);
  const speakingRef = useRef(false);
  const busyRef = useRef(false);
  const suppressRestartRef = useRef(false);
  const recognitionActiveRef = useRef(false);
  const recognitionCycleRef = useRef(0);
  const recognitionWatchdogRef = useRef<number | null>(null);
  const playbackAudioRef = useRef<HTMLAudioElement | null>(null);
  const playbackCancelledRef = useRef(false);
  const chatAbortControllerRef = useRef<AbortController | null>(null);
  const speechAbortControllerRef = useRef<AbortController | null>(null);
  const responseGenerationRef = useRef(0);
  const restartTimerRef = useRef<number | null>(null);
  const silenceTimerRef = useRef<number | null>(null);
  const lastRecognitionEventAtRef = useRef(0);
  const latestHeardRef = useRef("");
  const lastHandledRef = useRef("");
  const assistantSpeechRef = useRef("");
  const bargeInActiveRef = useRef(false);
  const micStreamRef = useRef<MediaStream | null>(null);
  const micAudioContextRef = useRef<AudioContext | null>(null);
  const micAnalyserRef = useRef<AnalyserNode | null>(null);
  const vadTimerRef = useRef<number | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const userSpeakingRef = useRef(false);
  const lastVoiceAtRef = useRef(0);
  const utteranceStartedAtRef = useRef(0);

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
      const resetTimer = window.setTimeout(() => {
        setWaveformData(Array(32).fill(6));
        setVolume(0);
      }, 0);
      return () => window.clearTimeout(resetTimer);
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

  async function startConversation() {
    if (runningRef.current) return;

    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("Microphone access is not available in this browser.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) {
        throw new Error("Audio processing is not available in this browser.");
      }
      const audioContext = new AudioContextClass();
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.25;
      audioContext.createMediaStreamSource(stream).connect(analyser);

      micStreamRef.current = stream;
      micAudioContextRef.current = audioContext;
      micAnalyserRef.current = analyser;
      runningRef.current = true;
      setIsRunning(true);
      setDuration(0);
      setStatus("Listening...");
      startVadLoop();
    } catch (error) {
      setStatus(error instanceof Error ? `Mic error: ${error.message}` : "Mic error.");
    }
  }

  function startVadLoop() {
    stopVadLoop();

    const analyser = micAnalyserRef.current;
    if (!analyser) return;

    const buffer = new Float32Array(analyser.fftSize);
    vadTimerRef.current = window.setInterval(() => {
      if (!runningRef.current || !micAnalyserRef.current) return;
      if (speakingRef.current && !allowBargeIn) return;

      micAnalyserRef.current.getFloatTimeDomainData(buffer);
      const rms = Math.sqrt(buffer.reduce((sum, value) => sum + value * value, 0) / buffer.length);
      const now = Date.now();
      const startThreshold = speakingRef.current ? 0.075 : 0.035;
      const stopAfterMs = 650;

      if (rms >= startThreshold) {
        lastVoiceAtRef.current = now;
        if (!userSpeakingRef.current) {
          userSpeakingRef.current = true;
          utteranceStartedAtRef.current = now;
          if (speakingRef.current) {
            bargeInActiveRef.current = true;
            interruptAssistantSpeech();
          }
          startUtteranceRecording();
          setStatus("Listening...");
        }
      }

      if (
        userSpeakingRef.current &&
        now - lastVoiceAtRef.current > stopAfterMs &&
        now - utteranceStartedAtRef.current > 450
      ) {
        stopUtteranceRecording();
      }
    }, 80);
  }

  function stopVadLoop() {
    if (vadTimerRef.current) {
      window.clearInterval(vadTimerRef.current);
      vadTimerRef.current = null;
    }
  }

  function startUtteranceRecording() {
    const stream = micStreamRef.current;
    if (!stream || mediaRecorderRef.current?.state === "recording") return;

    recordingChunksRef.current = [];
    const mimeType = preferredAudioMimeType();
    const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    mediaRecorderRef.current = recorder;

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        recordingChunksRef.current.push(event.data);
      }
    };

    recorder.onstop = () => {
      const chunks = recordingChunksRef.current;
      recordingChunksRef.current = [];
      mediaRecorderRef.current = null;
      userSpeakingRef.current = false;

      const durationMs = Date.now() - utteranceStartedAtRef.current;
      if (chunks.length === 0 || durationMs < 450) return;

      const blob = new Blob(chunks, { type: chunks[0]?.type || "audio/webm" });
      void handleUserAudio(blob);
    };

    recorder.start();
  }

  function stopUtteranceRecording() {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state !== "recording") {
      userSpeakingRef.current = false;
      return;
    }
    recorder.stop();
  }

  function stopMicCapture() {
    stopVadLoop();

    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state === "recording") {
      recorder.stop();
    }
    mediaRecorderRef.current = null;
    recordingChunksRef.current = [];
    userSpeakingRef.current = false;

    micStreamRef.current?.getTracks().forEach((track) => track.stop());
    micStreamRef.current = null;

    void micAudioContextRef.current?.close();
    micAudioContextRef.current = null;
    micAnalyserRef.current = null;
  }

  function stopConversation() {
    responseGenerationRef.current += 1;
    chatAbortControllerRef.current?.abort();
    chatAbortControllerRef.current = null;
    speechAbortControllerRef.current?.abort();
    speechAbortControllerRef.current = null;
    runningRef.current = false;
    speakingRef.current = false;
    busyRef.current = false;
    recognitionActiveRef.current = false;
    recognitionCycleRef.current += 1;

    if (restartTimerRef.current) {
      window.clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    if (recognitionWatchdogRef.current) {
      window.clearInterval(recognitionWatchdogRef.current);
      recognitionWatchdogRef.current = null;
    }
    clearSilenceTimer();

    recognitionRef.current?.abort();
    recognitionRef.current = null;
    stopMicCapture();
    assistantSpeechRef.current = "";
    bargeInActiveRef.current = false;
    window.speechSynthesis.cancel();
    stopPlaybackAudio();

    setIsRunning(false);
    setIsSpeaking(false);
    setIsThinking(false);
    setDuration(0);
    setStatus("Stopped");
  }

  function handlePrimaryControl() {
    if (isSpeaking) {
      interruptAssistantSpeech();
      return;
    }

    if (isRunning) {
      stopConversation();
      return;
    }

    startConversation();
  }

  function interruptAssistantSpeech() {
    responseGenerationRef.current += 1;
    chatAbortControllerRef.current?.abort();
    chatAbortControllerRef.current = null;
    speechAbortControllerRef.current?.abort();
    speechAbortControllerRef.current = null;
    stopPlaybackAudio();
    speakingRef.current = false;
    setIsSpeaking(false);
    setIsThinking(false);

    if (runningRef.current) {
      resumeRecognitionAfterPlayback();
      setStatus("Listening...");
    } else {
      setStatus("Ready");
    }
  }

  async function handleUserText(text: string) {
    const cleanText = text.trim();
    if (!cleanText) return;

    if (cleanText.toLowerCase() === lastHandledRef.current.toLowerCase()) {
      return;
    }

    lastHandledRef.current = cleanText;
    const generation = responseGenerationRef.current + 1;
    responseGenerationRef.current = generation;
    chatAbortControllerRef.current?.abort();
    chatAbortControllerRef.current = null;
    speechAbortControllerRef.current?.abort();
    speechAbortControllerRef.current = null;
    stopPlaybackAudio();
    bargeInActiveRef.current = false;

    const chatController = new AbortController();
    chatAbortControllerRef.current = chatController;
    let chatTimedOut = false;
    const chatTimeoutId = window.setTimeout(() => {
      chatTimedOut = true;
      chatController.abort();
    }, 20000);

    busyRef.current = true;
    setReply("");
    setTranscript(cleanText);
    setIsThinking(true);
    setStatus("Thinking...");

    try {
      const response = await fetch(`${backendUrl}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: chatController.signal,
        body: JSON.stringify({ message: cleanText, language, voice_style: voiceStyle }),
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      const data = (await response.json()) as { reply: string };
      if (generation !== responseGenerationRef.current) {
        return;
      }

      setReply(data.reply);
      assistantSpeechRef.current = data.reply;
      setIsThinking(false);
      await speak(data.reply, generation);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        if (generation === responseGenerationRef.current && chatTimedOut) {
          setStatus("Chat timed out after 20s.");
          setIsThinking(false);
        }
        return;
      }
      if (generation !== responseGenerationRef.current) {
        return;
      }
      setStatus(error instanceof Error ? error.message : "Request failed");
      setIsThinking(false);
    } finally {
      window.clearTimeout(chatTimeoutId);
      if (chatAbortControllerRef.current === chatController) {
        chatAbortControllerRef.current = null;
      }
      if (generation === responseGenerationRef.current) {
        busyRef.current = false;
      }
    }
  }

  async function handleUserAudio(audioBlob: Blob) {
    if (!runningRef.current || audioBlob.size < 4000) return;

    const generation = responseGenerationRef.current + 1;
    responseGenerationRef.current = generation;
    chatAbortControllerRef.current?.abort();
    chatAbortControllerRef.current = null;
    speechAbortControllerRef.current?.abort();
    speechAbortControllerRef.current = null;
    stopPlaybackAudio();
    bargeInActiveRef.current = false;

    const chatController = new AbortController();
    chatAbortControllerRef.current = chatController;
    let chatTimedOut = false;
    const chatTimeoutId = window.setTimeout(() => {
      chatTimedOut = true;
      chatController.abort();
    }, 30000);

    const formData = new FormData();
    formData.append("file", audioBlob, "utterance.webm");
    formData.append("language", language);
    formData.append("voice_style", voiceStyle);

    busyRef.current = true;
    setReply("");
    setIsThinking(true);
    setStatus("Understanding...");

    try {
      const response = await fetch(`${backendUrl}/voice-chat-text`, {
        method: "POST",
        signal: chatController.signal,
        body: formData,
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      const data = (await response.json()) as {
        transcript: string;
        reply: string;
        ignored?: boolean;
      };
      if (generation !== responseGenerationRef.current) return;
      if (data.ignored || !data.transcript.trim() || !data.reply.trim()) {
        setIsThinking(false);
        setStatus("Listening...");
        return;
      }
      if (looksLikeAssistantEcho(data.transcript, assistantSpeechRef.current)) {
        setIsThinking(false);
        setStatus("Listening...");
        return;
      }

      setTranscript(data.transcript);
      setReply(data.reply);
      assistantSpeechRef.current = data.reply;
      setIsThinking(false);
      await speak(data.reply, generation);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        if (generation === responseGenerationRef.current && chatTimedOut) {
          setStatus("Voice request timed out after 30s.");
          setIsThinking(false);
        }
        return;
      }
      if (generation !== responseGenerationRef.current) return;
      setStatus(error instanceof Error ? error.message : "Voice request failed");
      setIsThinking(false);
    } finally {
      window.clearTimeout(chatTimeoutId);
      if (chatAbortControllerRef.current === chatController) {
        chatAbortControllerRef.current = null;
      }
      if (generation === responseGenerationRef.current) {
        busyRef.current = false;
      }
    }
  }

  function clearSilenceTimer() {
    if (silenceTimerRef.current) {
      window.clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }

  function captureUserSpeechAfterBargeIn(text: string, isFinal: boolean) {
    const cleanText = text.trim();
    if (!cleanText) return;

    latestHeardRef.current = cleanText;
    setTranscript(cleanText);
    clearSilenceTimer();

    if (looksLikeAssistantEcho(cleanText, assistantSpeechRef.current)) {
      bargeInActiveRef.current = false;
      setStatus("Listening...");
      return;
    }

    if (isFinal) {
      bargeInActiveRef.current = false;
      void handleUserText(cleanText);
      return;
    }

    silenceTimerRef.current = window.setTimeout(() => {
      const latest = latestHeardRef.current.trim();
      if (!latest) return;
      bargeInActiveRef.current = false;
      if (looksLikeAssistantEcho(latest, assistantSpeechRef.current)) {
        setStatus("Listening...");
        return;
      }
      void handleUserText(latest);
    }, 450);
  }

  function speak(text: string, generation: number) {
    return speakWithBackendTts(text, generation);
  }

  async function speakWithBackendTts(text: string, generation: number) {
    speakingRef.current = true;
    setIsSpeaking(true);
    setStatus("Generating backend voice...");
    let playedAudio = false;
    let failedMessage = "";
    const controller = new AbortController();
    speechAbortControllerRef.current = controller;
    const timeoutId = window.setTimeout(() => controller.abort(), 30000);

    try {
      pauseRecognitionForPlayback();

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
        if (generation !== responseGenerationRef.current) {
          return;
        }

        if (audioBlob.size === 0) {
          throw new Error("Backend returned an empty audio file.");
        }

        const audioUrl = URL.createObjectURL(audioBlob);
        const audio = new Audio(audioUrl);
        audio.volume = 1;
        playbackCancelledRef.current = false;
        playbackAudioRef.current = audio;

        setStatus("Speaking...");
        try {
          if (generation !== responseGenerationRef.current) {
            return;
          }
          await playAudio(audio);
          playedAudio = true;
        } finally {
          if (playbackAudioRef.current === audio) {
            playbackAudioRef.current = null;
          }
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
      if (speechAbortControllerRef.current === controller) {
        speechAbortControllerRef.current = null;
      }

      if (generation !== responseGenerationRef.current) {
        return;
      }

      speakingRef.current = false;
      setIsSpeaking(false);
      resumeRecognitionAfterPlayback();

      const playbackCancelled = playbackCancelledRef.current;
      playbackCancelledRef.current = false;

      if (playbackCancelled) {
        return;
      }

      if (failedMessage) {
        setStatus(`Backend voice failed: ${failedMessage}`);
      } else if (playedAudio && runningRef.current) {
        setStatus("Listening...");
      } else if (playedAudio) {
        setStatus("Ready");
      }
    }
  }

  function pauseRecognitionForPlayback() {
    if (restartTimerRef.current) {
      window.clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    clearSilenceTimer();
    if (allowBargeIn) {
      suppressRestartRef.current = false;
      return;
    }
    suppressRestartRef.current = true;
    recognitionRef.current?.abort();
  }

  function resumeRecognitionAfterPlayback() {
    suppressRestartRef.current = false;
    latestHeardRef.current = "";

    if (!runningRef.current) {
      return;
    }

    window.setTimeout(() => {
      if (runningRef.current) {
        startVadLoop();
      }
    }, 250);
  }

  function stopPlaybackAudio() {
    const audio = playbackAudioRef.current;
    if (!audio) {
      return;
    }

    audio.pause();
    audio.currentTime = 0;
    playbackCancelledRef.current = true;
    playbackAudioRef.current = null;
  }

  function shouldBargeIn(text: string, isFinal: boolean) {
    const cleaned = text.trim();
    if (!cleaned) {
      return false;
    }

    const wordCount = cleaned.split(/\s+/).filter(Boolean).length;
    if (!isFinal && wordCount < 3) {
      return false;
    }

    return !looksLikeAssistantEcho(cleaned, assistantSpeechRef.current);
  }

  function looksLikeAssistantEcho(heardText: string, assistantText: string) {
    const heardWords = normalizedWords(heardText);
    const assistantWords = normalizedWords(assistantText);

    if (heardWords.length === 0 || assistantWords.length === 0) {
      return false;
    }

    const heard = heardWords.join(" ");
    const assistant = assistantWords.join(" ");
    if (heard.length >= 8 && assistant.includes(heard)) {
      return true;
    }
    if (assistant.length >= 8 && heard.includes(assistant)) {
      return true;
    }

    const assistantSet = new Set(assistantWords);
    const overlap = heardWords.filter((word) => assistantSet.has(word)).length;
    return overlap / heardWords.length >= 0.45;
  }

  function normalizedWords(text: string) {
    return text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((word) => word.length > 1);
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
      <section className="relative min-h-[calc(100vh-1rem)] overflow-hidden rounded-2xl bg-black sm:min-h-[calc(100vh-1.5rem)] md:rounded-[2rem]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.08),rgba(0,0,0,0.96)_58%,#000_100%)]" />
        <OrbitalBackground activeMode={activeMode} />
        <div className="noise-overlay pointer-events-none absolute inset-0 opacity-15 mix-blend-screen" />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/30 via-transparent to-black/80" />

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
            <aside className="order-2 rounded-lg border border-white/20 bg-black/80 p-4 shadow-2xl shadow-black backdrop-blur-md lg:order-1">
              <div className="flex items-center gap-2 text-sm font-medium text-white/85">
                <Settings2 className="h-4 w-4" />
                Controls
              </div>

              <label className="mt-5 block text-xs uppercase tracking-[0.18em] text-white/45" htmlFor="backend-url">
                Backend URL
              </label>
              <input
                id="backend-url"
                className="mt-2 w-full rounded-md border border-white/15 bg-black/85 px-3 py-2 text-sm text-white outline-none transition focus:border-white/70"
                value={backendUrl}
                onChange={(event) => setBackendUrl(event.target.value)}
              />

              <label className="mt-4 block text-xs uppercase tracking-[0.18em] text-white/45" htmlFor="language">
                Browser speech language
              </label>
              <select
                id="language"
                className="mt-2 w-full rounded-md border border-white/15 bg-black/85 px-3 py-2 text-sm text-white outline-none transition focus:border-white/70"
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

              <label className="mt-4 block text-xs uppercase tracking-[0.18em] text-white/45" htmlFor="voice-style">
                Agent voice
              </label>
              <select
                id="voice-style"
                className="mt-2 w-full rounded-md border border-white/15 bg-black/85 px-3 py-2 text-sm text-white outline-none transition focus:border-white/70"
                value={voiceStyle}
                onChange={(event) => setVoiceStyle(event.target.value as VoiceStyle)}
              >
                {VOICE_STYLES.map((style) => (
                  <option key={style.value} value={style.value}>
                    {style.label}
                  </option>
                ))}
              </select>

              <p className="mt-4 rounded-md border border-white/20 bg-white/5 px-3 py-2 text-sm text-white/80">
                Output voice: backend agent TTS
              </p>

              <label
                className="mt-4 flex items-center justify-between gap-3 rounded-md border border-white/15 bg-black/70 px-3 py-2 text-sm text-white/80"
                htmlFor="barge-in"
              >
                <span>Talk over assistant</span>
                <input
                  id="barge-in"
                  type="checkbox"
                  className="h-4 w-4 accent-white"
                  checked={allowBargeIn}
                  onChange={(event) => setAllowBargeIn(event.target.checked)}
                />
              </label>

              <div className="mt-5 flex gap-2">
                <input
                  id="typed-message"
                  className="min-w-0 flex-1 rounded-md border border-white/15 bg-black/85 px-3 py-2 text-sm text-white outline-none transition placeholder:text-white/25 focus:border-white/70"
                  value={typedMessage}
                  onChange={(event) => setTypedMessage(event.target.value)}
                  placeholder="Type a message"
                />
                <button
                  className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-white text-black transition hover:bg-white/85 disabled:cursor-not-allowed disabled:opacity-50"
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
                <p className="text-sm font-medium text-white/60"></p>
                <h1 className="mt-2 max-w-[92vw] text-4xl font-semibold leading-none tracking-normal text-white sm:text-6xl lg:text-7xl xl:text-8xl">
                  Voice Assistant
                </h1>
              </motion.div>

              <div className="relative flex h-[340px] w-full max-w-[500px] items-center justify-center overflow-hidden lg:h-[390px]">
                {particles.map((particle) => (
                  <motion.div
                    key={particle.id}
                    className="absolute rounded-full bg-white/25"
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
                    onClick={handlePrimaryControl}
                    className={`relative flex h-28 w-28 items-center justify-center rounded-full border-2 bg-white/10 transition-all duration-300 sm:h-32 sm:w-32 ${
                      activeMode === "idle"
                        ? "border-white/25 hover:border-white/70"
                        : "border-white shadow-lg shadow-white/20"
                    }`}
                    whileHover={{ scale: 1.04 }}
                    whileTap={{ scale: 0.96 }}
                    animate={{
                      boxShadow:
                        activeMode === "listening"
                          ? [
                              "0 0 0 0 rgba(255, 255, 255, 0.28)",
                              "0 0 0 22px rgba(255, 255, 255, 0)",
                            ]
                          : undefined,
                    }}
                    transition={{
                      duration: 1.5,
                      repeat: activeMode === "listening" ? Infinity : 0,
                    }}
                    aria-label={
                      isSpeaking
                        ? "Interrupt assistant speech"
                        : isRunning
                          ? "Stop conversation"
                          : "Start conversation"
                    }
                  >
                    <AnimatePresence mode="wait">
                      {activeMode === "processing" ? (
                        <motion.span
                          key="processing"
                          initial={{ opacity: 0, scale: 0.8 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.8 }}
                          className="h-20 w-28"
                        >
                          <AssistantCore mode="processing" />
                        </motion.span>
                      ) : activeMode === "speaking" ? (
                        <motion.span
                          key="speaking"
                          initial={{ opacity: 0, scale: 0.8 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.8 }}
                          className="h-20 w-28"
                        >
                          <AssistantCore mode="speaking" />
                        </motion.span>
                      ) : activeMode === "listening" ? (
                        <motion.span
                          key="listening"
                          initial={{ opacity: 0, scale: 0.8 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.8 }}
                        >
                          <Square className="h-11 w-11 fill-white text-white" />
                        </motion.span>
                      ) : (
                        <motion.span
                          key="idle"
                          initial={{ opacity: 0, scale: 0.8 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.8 }}
                        >
                          <Mic className="h-12 w-12 text-white/75" />
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </motion.button>

                  <div className="flex h-12 items-center justify-center gap-1 sm:h-14">
                    {waveformData.map((height, index) => (
                      <motion.div
                        key={index}
                        className={`w-1 rounded-full ${
                          activeMode === "idle" ? "bg-white/25" : "bg-white"
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
                        activeMode === "idle" ? "text-white/70" : "text-white"
                      }`}
                      animate={{ opacity: activeMode === "idle" ? 1 : [1, 0.65, 1] }}
                      transition={{
                        duration: 2,
                        repeat: activeMode === "idle" ? 0 : Infinity,
                      }}
                    >
                      {status}
                    </motion.p>
                    <p className="font-mono text-sm text-white/45">
                      {formatTime(Math.floor(duration / 5))}
                    </p>

                    {volume > 0 && (
                      <motion.div
                        className="flex items-center justify-center gap-2"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                      >
                        <VolumeX className="h-4 w-4 text-white/45" />
                        <div className="h-2 w-24 overflow-hidden rounded-full bg-white/15">
                          <motion.div
                            className="h-full rounded-full bg-white"
                            animate={{ width: `${volume}%` }}
                            transition={{ duration: 0.1 }}
                          />
                        </div>
                        <Volume2 className="h-4 w-4 text-white/45" />
                      </motion.div>
                    )}
                  </div>

                  <motion.div
                    className="flex items-center gap-2 text-sm text-white/55"
                    animate={{ opacity: [0.5, 1, 0.5] }}
                    transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
                  >
                    <Sparkles className="h-4 w-4" />
                    <span>AI Voice Assistant</span>
                  </motion.div>
                </div>
              </div>
            </section>

            <aside className="order-3 rounded-lg border border-white/20 bg-black/80 p-4 shadow-2xl shadow-black backdrop-blur-md">
              <p className="text-xs uppercase tracking-[0.18em] text-white/45">You said</p>
              <p className="mt-2 min-h-28 rounded-md border border-white/15 bg-black/85 p-3 text-sm leading-7 text-white/85">
                {transcript || "No speech captured yet."}
              </p>

              <p className="mt-5 text-xs uppercase tracking-[0.18em] text-white/45">Assistant</p>
              <p className="mt-2 min-h-36 rounded-md border border-white/15 bg-black/85 p-3 text-sm leading-7 text-white/85">
                {reply || "No reply yet."}
              </p>

              <p className="mt-4 text-xs leading-5 text-white/35">
                running: {isRunning ? "yes" : "no"} | speaking: {isSpeaking ? "yes" : "no"} | mic:
                {allowBargeIn ? "barge-in enabled" : "pauses during assistant speech"}
              </p>
            </aside>
          </div>
        </div>
      </section>
    </main>
  );
}

function OrbitalBackground({ activeMode }: { activeMode: ActiveMode }) {
  const nodes: OrbitalNode[] = [
    { id: 1, angle: 0, radius: 190, size: 10, opacity: 0.72 },
    { id: 2, angle: 56, radius: 250, size: 7, opacity: 0.42 },
    { id: 3, angle: 118, radius: 150, size: 8, opacity: 0.6 },
    { id: 4, angle: 184, radius: 285, size: 9, opacity: 0.5 },
    { id: 5, angle: 238, radius: 220, size: 6, opacity: 0.38 },
    { id: 6, angle: 306, radius: 165, size: 8, opacity: 0.55 },
  ];
  const rotationDuration =
    activeMode === "speaking" ? 15 : activeMode === "processing" ? 19 : 28;

  return (
    <div
      className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden"
      aria-hidden="true"
    >
      <div className="absolute h-[720px] w-[720px] max-w-[150vw] rounded-full border border-white/5" />
      <div className="absolute h-[560px] w-[560px] max-w-[120vw] rounded-full border border-white/10" />
      <div className="absolute h-[390px] w-[390px] max-w-[92vw] rounded-full border border-white/10" />
      <div className="absolute h-[250px] w-[250px] max-w-[68vw] rounded-full border border-white/[0.07]" />

      <motion.div
        className="absolute h-[640px] w-[640px] max-w-[138vw]"
        animate={{ rotate: 360 }}
        transition={{ duration: rotationDuration, repeat: Infinity, ease: "linear" }}
      >
        {nodes.map((node) => {
          const radian = (node.angle * Math.PI) / 180;
          const x = Math.cos(radian) * node.radius;
          const y = Math.sin(radian) * node.radius;

          return (
            <motion.div
              key={node.id}
              className="absolute left-1/2 top-1/2 rounded-full border border-white/35 bg-black shadow-[0_0_18px_rgba(255,255,255,0.18)]"
              style={{
                height: node.size,
                width: node.size,
                x,
                y,
                opacity: node.opacity,
              }}
              animate={{ scale: [1, 1.45, 1], opacity: [node.opacity, 1, node.opacity] }}
              transition={{
                duration: 2.8 + node.id * 0.18,
                repeat: Infinity,
                ease: "easeInOut",
              }}
            />
          );
        })}
      </motion.div>

      <motion.div
        className="absolute flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-purple-500 via-blue-500 to-teal-500 opacity-80 blur-[0.2px]"
        animate={{
          scale: activeMode === "idle" ? [1, 1.08, 1] : [1, 1.18, 1],
          opacity: activeMode === "idle" ? [0.45, 0.72, 0.45] : [0.68, 0.95, 0.68],
        }}
        transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
      >
        <div className="absolute h-24 w-24 rounded-full border border-white/15" />
        <div className="absolute h-32 w-32 rounded-full border border-white/10" />
        <div className="h-9 w-9 rounded-full bg-white/80 shadow-[0_0_24px_rgba(255,255,255,0.35)]" />
      </motion.div>

      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.025)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.025)_1px,transparent_1px)] bg-[size:44px_44px] opacity-30" />
    </div>
  );
}

function AssistantCore({ mode }: { mode: "processing" | "speaking" }) {
  const isSpeaking = mode === "speaking";
  const lineColor = "white";
  const text = isSpeaking ? "HI" : "AI";

  return (
    <svg className="h-full w-full" viewBox="0 0 220 150" fill="none" aria-hidden="true">
      <g stroke={lineColor}>
        <motion.path
          d="M24 36 H82 C91 36 96 41 96 50 V70"
          strokeWidth="1.2"
          strokeDasharray="120"
          initial={{ strokeDashoffset: 120 }}
          animate={{ strokeDashoffset: 0 }}
          transition={{ duration: 0.9, ease: "easeOut" }}
        />
        <motion.path
          d="M196 34 H134 C124 34 119 39 119 49 V67"
          strokeWidth="1.2"
          strokeDasharray="120"
          initial={{ strokeDashoffset: 120 }}
          animate={{ strokeDashoffset: 0 }}
          transition={{ duration: 0.9, delay: 0.1, ease: "easeOut" }}
        />
        <motion.path
          d="M36 112 H76 C89 112 96 105 96 93 V82"
          strokeWidth="1.2"
          strokeDasharray="120"
          initial={{ strokeDashoffset: 120 }}
          animate={{ strokeDashoffset: 0 }}
          transition={{ duration: 0.9, delay: 0.2, ease: "easeOut" }}
        />
        <motion.path
          d="M184 114 H142 C128 114 119 105 119 92 V81"
          strokeWidth="1.2"
          strokeDasharray="120"
          initial={{ strokeDashoffset: 120 }}
          animate={{ strokeDashoffset: 0 }}
          transition={{ duration: 0.9, delay: 0.3, ease: "easeOut" }}
        />
      </g>

      <g>
        {[
          { path: "M24 36 H96", color: "white", delay: 0 },
          { path: "M196 34 H119", color: "white", delay: 0.4 },
          { path: "M36 112 H96", color: "white", delay: 0.8 },
          { path: "M184 114 H119", color: "white", delay: 1.2 },
        ].map((pulse) => (
          <motion.circle
            key={pulse.path}
            r="4"
            fill={pulse.color}
            filter="url(#assistant-core-glow)"
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 1, 0] }}
            transition={{
              duration: isSpeaking ? 1.6 : 2.2,
              repeat: Infinity,
              delay: pulse.delay,
              ease: "easeInOut",
            }}
          >
            <animateMotion dur={isSpeaking ? "1.6s" : "2.2s"} repeatCount="indefinite" path={pulse.path} />
          </motion.circle>
        ))}
      </g>

      <motion.rect
        x="82"
        y="58"
        width="56"
        height="36"
        rx="8"
        fill="#08090b"
        stroke={lineColor}
        strokeWidth="1"
        filter="url(#assistant-core-shadow)"
        animate={{
          strokeOpacity: [0.45, 1, 0.45],
          scale: isSpeaking ? [1, 1.04, 1] : [1, 1.02, 1],
        }}
        transition={{ duration: isSpeaking ? 1.1 : 1.7, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.text
        x="110"
        y="81"
        textAnchor="middle"
        fontSize="16"
        fontWeight="700"
        fill={lineColor}
        animate={{ opacity: [0.62, 1, 0.62] }}
        transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
      >
        {text}
      </motion.text>

      {[
        [92, 52],
        [108, 52],
        [126, 52],
        [92, 100],
        [108, 100],
        [126, 100],
        [76, 68],
        [76, 84],
        [144, 68],
        [144, 84],
      ].map(([cx, cy]) => (
        <motion.circle
          key={`${cx}-${cy}`}
          cx={cx}
          cy={cy}
          r="2"
          fill={lineColor}
          animate={{ opacity: [0.25, 1, 0.25] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
        />
      ))}

      <defs>
        <filter id="assistant-core-glow" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id="assistant-core-shadow" x="-60%" y="-80%" width="220%" height="260%">
          <feDropShadow dx="0" dy="0" stdDeviation="6" floodColor={lineColor} floodOpacity="0.38" />
        </filter>
      </defs>
    </svg>
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

function preferredAudioMimeType() {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
  ];

  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

async function playAudio(audio: HTMLAudioElement) {
  const ended = new Promise<void>((resolve, reject) => {
    audio.onended = () => resolve();
    audio.onpause = () => resolve();
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
