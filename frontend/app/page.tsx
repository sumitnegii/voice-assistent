"use client";

import { useRef, useState } from "react";

const DEFAULT_BACKEND_URL = "http://127.0.0.1:8000";

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

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

export default function Page() {
  const [backendUrl, setBackendUrl] = useState(DEFAULT_BACKEND_URL);
  const [language, setLanguage] = useState("en-US");
  const [status, setStatus] = useState("Ready");
  const [transcript, setTranscript] = useState("");
  const [reply, setReply] = useState("");
  const [typedMessage, setTypedMessage] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [useBackendTts, setUseBackendTts] = useState(true);

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const runningRef = useRef(false);
  const speakingRef = useRef(false);
  const busyRef = useRef(false);
  const restartTimerRef = useRef<number | null>(null);
  const silenceTimerRef = useRef<number | null>(null);
  const latestHeardRef = useRef("");
  const lastHandledRef = useRef("");

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
      await speak(data.reply);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Request failed");
      busyRef.current = false;
    }
  }

  function clearSilenceTimer() {
    if (silenceTimerRef.current) {
      window.clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }

  function speak(text: string) {
    if (useBackendTts) {
      return speakWithBackendTts(text);
    }

    return new Promise<void>((resolve) => {
      window.speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = language === "hi-IN" ? "hi-IN" : "en-US";
      utterance.rate = 1.15;
      utterance.pitch = 1;
      utterance.volume = 1;

      const finish = () => {
        speakingRef.current = false;
        setIsSpeaking(false);
        if (runningRef.current) {
          setStatus("Listening...");
        }
        resolve();
      };

      utterance.onstart = () => {
        speakingRef.current = true;
        setIsSpeaking(true);
        setStatus("Speaking... talk to interrupt");
      };
      utterance.onend = finish;
      utterance.onerror = finish;

      window.speechSynthesis.speak(utterance);
    });
  }

  async function speakWithBackendTts(text: string) {
    speakingRef.current = true;
    setIsSpeaking(true);
    setStatus("Generating XTTS voice...");

    try {
      const response = await fetch(`${backendUrl}/speak`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      const audioBlob = await response.blob();
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);

      setStatus("Speaking... talk to interrupt");
      await new Promise<void>((resolve) => {
        audio.onended = () => resolve();
        audio.onerror = () => resolve();
        audio.play().catch(() => resolve());
      });
      URL.revokeObjectURL(audioUrl);
    } finally {
      speakingRef.current = false;
      setIsSpeaking(false);
      if (runningRef.current) {
        setStatus("Listening...");
      }
    }
  }

  return (
    <main className="min-h-screen bg-zinc-950 px-5 py-8 text-zinc-100">
      <section className="mx-auto flex w-full max-w-3xl flex-col gap-5">
        <div>
          <p className="text-sm font-medium text-cyan-300">Simple Conversation Test</p>
          <h1 className="mt-2 text-3xl font-semibold">Voice Assistant</h1>
        </div>

        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
          <label className="block text-sm text-zinc-300" htmlFor="backend-url">
            Backend URL
          </label>
          <input
            id="backend-url"
            className="mt-2 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-cyan-400"
            value={backendUrl}
            onChange={(event) => setBackendUrl(event.target.value)}
          />

          <label className="mt-4 block text-sm text-zinc-300" htmlFor="language">
            Browser speech language
          </label>
          <select
            id="language"
            className="mt-2 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-cyan-400"
            value={language}
            onChange={(event) => setLanguage(event.target.value)}
            disabled={isRunning}
          >
            <option value="en-US">English</option>
            <option value="hi-IN">Hindi</option>
          </select>

          <label className="mt-4 flex items-center gap-2 text-sm text-zinc-300">
            <input
              type="checkbox"
              checked={useBackendTts}
              onChange={(event) => setUseBackendTts(event.target.checked)}
            />
            Use backend TTS / XTTS-v2
          </label>
        </div>

        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
          <label className="block text-sm text-zinc-300" htmlFor="typed-message">
            Text test
          </label>
          <div className="mt-2 flex gap-2">
            <input
              id="typed-message"
              className="min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-cyan-400"
              value={typedMessage}
              onChange={(event) => setTypedMessage(event.target.value)}
              placeholder="Type a message to test /chat"
            />
            <button
              className="rounded-md bg-zinc-100 px-4 py-2 text-sm font-semibold text-zinc-950 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={!typedMessage.trim()}
              onClick={() => void handleUserText(typedMessage)}
            >
              Send
            </button>
          </div>
        </div>

        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
          <div className="flex flex-wrap gap-3">
            <button
              className="rounded-md bg-cyan-400 px-4 py-2 text-sm font-semibold text-zinc-950 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isRunning}
              onClick={startConversation}
            >
              Start Conversation
            </button>

            <button
              className="rounded-md border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-100 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={!isRunning}
              onClick={stopConversation}
            >
              Stop
            </button>
          </div>

          <div className="mt-4 flex items-center justify-between gap-4">
            <p className="text-sm text-zinc-400">Status</p>
            <p className="text-sm text-cyan-300">{status}</p>
          </div>

          <p className="mt-2 text-xs text-zinc-500">
            running: {isRunning ? "yes" : "no"} | speaking: {isSpeaking ? "yes" : "no"} | interrupt: speak over AI
          </p>
        </div>

        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
          <p className="text-sm text-zinc-400">You said</p>
          <p className="mt-2 min-h-16 rounded-md bg-zinc-950 p-3 leading-7">
            {transcript || "No speech captured yet."}
          </p>

          <p className="mt-4 text-sm text-zinc-400">Assistant</p>
          <p className="mt-2 min-h-16 rounded-md bg-zinc-950 p-3 leading-7">
            {reply || "No reply yet."}
          </p>
        </div>
      </section>
    </main>
  );
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
