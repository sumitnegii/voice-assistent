import base64
import os
import shutil
import time
import uuid
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

from llm import generate_reply
from stt import _get_model, transcribe_audio
from tools import run_tools
from tts import synthesize_speech


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


class ChatRequest(BaseModel):
    message: str


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
    reply = generate_reply(request.message)
    return ChatResponse(reply=reply)


@app.post("/speak")
def speak(request: ChatRequest) -> FileResponse:
    try:
        audio_path = synthesize_speech(request.message)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return FileResponse(
        audio_path,
        media_type="audio/wav",
        filename=audio_path.name,
    )


@app.post("/voice-chat")
def voice_chat(
    file: UploadFile = File(...),
    language: str | None = Form(default=None),
) -> FileResponse:
    transcript, reply, ignored = _run_voice_brain(file, language)
    if ignored:
        raise HTTPException(status_code=204, detail="Ignored noisy audio.")

    try:
        tts_started_at = time.perf_counter()
        audio_path = synthesize_speech(reply)
        print("voice-chat tts:", f"{time.perf_counter() - tts_started_at:.2f}s")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return FileResponse(
        audio_path,
        media_type="audio/wav",
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
) -> VoiceChatTextResponse:
    transcript, reply, ignored = _run_voice_brain(file, language)
    return VoiceChatTextResponse(transcript=transcript, reply=reply, ignored=ignored)


def _run_voice_brain(file: UploadFile, language: str | None) -> tuple[str, str, bool]:
    UPLOAD_DIR.mkdir(exist_ok=True)
    suffix = Path(file.filename or "audio.webm").suffix or ".webm"
    upload_path = UPLOAD_DIR / f"input-{uuid.uuid4().hex}{suffix}"

    with upload_path.open("wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    try:
        started_at = time.perf_counter()
        transcript = transcribe_audio(upload_path, _normalize_language(language))
        asr_done_at = time.perf_counter()
        tool_context = run_tools(transcript)
        llm_message = transcript
        if tool_context:
            llm_message = f"{transcript}\n\nTool result:\n{tool_context}"

        reply = generate_reply(llm_message)
        llm_done_at = time.perf_counter()
        print(
            "voice-brain timings:",
            f"asr={asr_done_at - started_at:.2f}s",
            f"llm={llm_done_at - asr_done_at:.2f}s",
            f"total={llm_done_at - started_at:.2f}s",
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

    return transcript, reply, False


def _encode_header(value: str) -> str:
    return base64.b64encode(value.encode("utf-8")).decode("ascii")


def _normalize_language(language: str | None) -> str | None:
    if not language or language == "auto":
        return None
    return language
