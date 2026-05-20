import base64
import os
import shutil
import threading
import time
import uuid
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

from stt import _get_model
from voice_pipeline import run_audio_pipeline, run_text_pipeline, synthesize_pipeline_reply


app = FastAPI(title="Voice Assistant Prototype")

DEFAULT_CORS_ORIGINS = [
    "http://localhost:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:3001",
    "https://voice-assistent-blue.vercel.app",
]

CORS_ORIGINS = [
    origin.strip()
    for origin in os.getenv("CORS_ORIGINS", ",".join(DEFAULT_CORS_ORIGINS)).split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["x-transcript-b64", "x-reply-b64"],
)

UPLOAD_DIR = Path(__file__).parent / "uploads"
DEDUP_WINDOW_SECONDS = float(os.getenv("REQUEST_DEDUP_WINDOW_SECONDS", "4"))
_CHAT_RESULTS: dict[tuple[str, str], tuple[float, str]] = {}
_CHAT_IN_FLIGHT: dict[tuple[str, str], threading.Event] = {}
_CHAT_LOCK = threading.Lock()
_SPEAK_IN_FLIGHT: set[tuple[str, str, str]] = set()
_SPEAK_LOCK = threading.Lock()


class ChatRequest(BaseModel):
    message: str
    language: str | None = None
    voice_style: str | None = None


class ChatResponse(BaseModel):
    reply: str


class VoiceChatTextResponse(BaseModel):
    transcript: str
    reply: str
    ignored: bool = False


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.on_event("startup")
def warmup_models() -> None:
    started_at = time.perf_counter()
    _get_model()
    print("startup warmup:", f"whisper={time.perf_counter() - started_at:.2f}s")


@app.post("/chat", response_model=ChatResponse)
def chat(request: ChatRequest) -> ChatResponse:
    language = _normalize_language(request.language)
    key = _request_key(request.message, language)
    request_id = uuid.uuid4().hex[:8]
    wait_for: threading.Event | None = None

    with _CHAT_LOCK:
      cached = _CHAT_RESULTS.get(key)
      if cached and time.monotonic() - cached[0] <= DEDUP_WINDOW_SECONDS:
          print("chat duplicate cached:", request_id, f"language={language}", f"message={request.message!r}")
          return ChatResponse(reply=cached[1])

      wait_for = _CHAT_IN_FLIGHT.get(key)
      if wait_for is None:
          wait_for = threading.Event()
          _CHAT_IN_FLIGHT[key] = wait_for
          should_process = True
      else:
          should_process = False

    if not should_process:
        print("chat duplicate waiting:", request_id, f"language={language}", f"message={request.message!r}")
        wait_for.wait(timeout=60)
        with _CHAT_LOCK:
            cached = _CHAT_RESULTS.get(key)
        if cached:
            return ChatResponse(reply=cached[1])
        raise HTTPException(status_code=409, detail="Duplicate chat request did not complete.")

    print("chat start:", request_id, f"language={language}", f"message={request.message!r}")
    started_at = time.perf_counter()
    try:
        result = run_text_pipeline(request.message, language, voice_style=request.voice_style)
        with _CHAT_LOCK:
            _CHAT_RESULTS[key] = (time.monotonic(), result.reply)
        print("chat done:", request_id, f"{time.perf_counter() - started_at:.2f}s", f"reply={result.reply!r}")
        return ChatResponse(reply=result.reply)
    finally:
        with _CHAT_LOCK:
            event = _CHAT_IN_FLIGHT.pop(key, None)
            if event:
                event.set()


@app.post("/speak")
def speak(request: ChatRequest) -> FileResponse:
    key = _speak_key(request)
    request_id = uuid.uuid4().hex[:8]
    with _SPEAK_LOCK:
        if key in _SPEAK_IN_FLIGHT:
            print("speak duplicate rejected:", request_id, f"message={request.message!r}")
            raise HTTPException(status_code=409, detail="Duplicate TTS request already in progress.")
        _SPEAK_IN_FLIGHT.add(key)

    try:
        audio_path, timings = synthesize_pipeline_reply(
            request.message,
            language=request.language,
            voice_style=request.voice_style,
        )
        print("speak tts:", request_id, f"{timings.tts_seconds:.2f}s", f"message={request.message!r}")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        with _SPEAK_LOCK:
            _SPEAK_IN_FLIGHT.discard(key)

    return FileResponse(
        audio_path,
        media_type=_audio_media_type(audio_path),
        filename=audio_path.name,
    )


@app.post("/voice-chat")
def voice_chat(
    file: UploadFile = File(...),
    language: str | None = Form(default=None),
    voice_style: str | None = Form(default=None),
) -> FileResponse:
    transcript, reply, ignored = _run_voice_brain(file, language, voice_style)
    if ignored:
        raise HTTPException(status_code=204, detail="Ignored noisy audio.")

    try:
        audio_path, timings = synthesize_pipeline_reply(reply, language=language, voice_style=voice_style)
        print("voice-chat tts:", f"{timings.tts_seconds:.2f}s")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return FileResponse(
        audio_path,
        media_type=_audio_media_type(audio_path),
        filename=audio_path.name,
        headers={
            "x-transcript-b64": _encode_header(transcript),
            "x-reply-b64": _encode_header(reply),
        },
    )


@app.post("/voice-chat-text", response_model=VoiceChatTextResponse)
def voice_chat_text(
    file: UploadFile = File(...),
    language: str | None = Form(default=None),
    voice_style: str | None = Form(default=None),
) -> VoiceChatTextResponse:
    transcript, reply, ignored = _run_voice_brain(file, language, voice_style)
    return VoiceChatTextResponse(transcript=transcript, reply=reply, ignored=ignored)


def _run_voice_brain(
    file: UploadFile,
    language: str | None,
    voice_style: str | None = None,
) -> tuple[str, str, bool]:
    UPLOAD_DIR.mkdir(exist_ok=True)
    suffix = Path(file.filename or "audio.webm").suffix or ".webm"
    upload_path = UPLOAD_DIR / f"input-{uuid.uuid4().hex}{suffix}"

    with upload_path.open("wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    try:
        result, timings = run_audio_pipeline(upload_path, _normalize_language(language), voice_style=voice_style)
        print(
            "voice-brain timings:",
            f"asr={timings.asr_seconds:.2f}s",
            f"llm={timings.llm_seconds:.2f}s",
            f"total={timings.total_seconds:.2f}s",
        )
    except NotImplementedError as exc:
        raise HTTPException(status_code=501, detail=str(exc)) from exc
    except RuntimeError as exc:
        message = str(exc)
        if (
            "No confident speech detected" in message
            or "Ignored very short/noisy audio" in message
            or "Ignored likely noise/echo" in message
        ):
            print("voice-brain ignored:", message)
            return "", "", True
        raise HTTPException(status_code=500, detail=message) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return result.transcript, result.reply, False


def _encode_header(value: str) -> str:
    return base64.b64encode(value.encode("utf-8")).decode("ascii")


def _audio_media_type(audio_path: Path) -> str:
    if audio_path.suffix.lower() == ".mp3":
        return "audio/mpeg"
    return "audio/wav"


def _normalize_language(language: str | None) -> str | None:
    if not language or language == "auto":
        return None
    return language


def _request_key(message: str, language: str | None) -> tuple[str, str]:
    return (language or "", " ".join(message.casefold().split()))


def _speak_key(request: ChatRequest) -> tuple[str, str, str]:
    return (
        request.language or "",
        request.voice_style or "",
        " ".join(request.message.casefold().split()),
    )
