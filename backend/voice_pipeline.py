import time
from dataclasses import dataclass
from pathlib import Path

from llm import generate_reply
from stt import transcribe_audio
from tools import run_tools
from tts import synthesize_speech


@dataclass(frozen=True)
class VoicePipelineResult:
    transcript: str
    reply: str
    tool_context: str = ""
    ignored: bool = False


@dataclass(frozen=True)
class VoicePipelineTimings:
    asr_seconds: float = 0
    llm_seconds: float = 0
    tts_seconds: float = 0
    total_seconds: float = 0


def run_text_pipeline(message: str) -> VoicePipelineResult:
    """Pipecat-style text pipeline: user text -> tools/context -> LLM reply."""
    cleaned = message.strip()
    tool_context = run_tools(cleaned)
    reply = generate_reply(_message_with_tool_context(cleaned, tool_context))
    return VoicePipelineResult(transcript=cleaned, reply=reply, tool_context=tool_context)


def run_audio_pipeline(
    audio_path: Path,
    language: str | None,
) -> tuple[VoicePipelineResult, VoicePipelineTimings]:
    """Pipecat-style audio brain: audio -> STT -> tools/context -> LLM reply."""
    started_at = time.perf_counter()
    transcript = transcribe_audio(audio_path, language)
    asr_done_at = time.perf_counter()

    text_result = run_text_pipeline(transcript)
    llm_done_at = time.perf_counter()

    timings = VoicePipelineTimings(
        asr_seconds=asr_done_at - started_at,
        llm_seconds=llm_done_at - asr_done_at,
        total_seconds=llm_done_at - started_at,
    )
    return text_result, timings


def synthesize_pipeline_reply(
    reply: str,
    language: str | None = None,
    voice_style: str | None = None,
) -> tuple[Path, VoicePipelineTimings]:
    """Pipecat-style output stage: assistant text -> TTS audio."""
    started_at = time.perf_counter()
    audio_path = synthesize_speech(reply, language=language, voice_style=voice_style)
    return audio_path, VoicePipelineTimings(
        tts_seconds=time.perf_counter() - started_at,
        total_seconds=time.perf_counter() - started_at,
    )


def _message_with_tool_context(message: str, tool_context: str) -> str:
    if not tool_context:
        return message
    return f"{message}\n\nTool result:\n{tool_context}"
