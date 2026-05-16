import os
from pathlib import Path
from functools import lru_cache

ALLOWED_AUTO_LANGUAGES = {"en", "hi", "ur"}


@lru_cache(maxsize=1)
def _get_model():
    try:
        from faster_whisper import WhisperModel
    except ImportError as exc:
        raise RuntimeError(
            "ASR is not installed. Run: pip install -r backend/requirements.txt"
        ) from exc

    model_size = os.getenv("WHISPER_MODEL", "base")
    return WhisperModel(
        model_size,
        device=os.getenv("WHISPER_DEVICE", "cpu"),
        compute_type=os.getenv("WHISPER_COMPUTE_TYPE", "int8"),
    )


def transcribe_audio(audio_path: Path, language: str | None = None) -> str:
    """Transcribe an uploaded utterance with faster-whisper."""
    if audio_path.stat().st_size < int(os.getenv("MIN_AUDIO_BYTES", "12000")):
        raise RuntimeError("Ignored very short/noisy audio.")

    model = _get_model()
    segments, info = model.transcribe(
        str(audio_path),
        beam_size=int(os.getenv("WHISPER_BEAM_SIZE", "3")),
        condition_on_previous_text=False,
        language=language or os.getenv("WHISPER_LANGUAGE") or None,
        vad_filter=True,
        vad_parameters={
            "min_silence_duration_ms": 400,
            "speech_pad_ms": 120,
        },
    )
    accepted_segments = []
    if not language and info.language not in ALLOWED_AUTO_LANGUAGES:
        raise RuntimeError(
            f"Ignored likely noise/echo. Detected unsupported language={info.language} "
            f"with probability={info.language_probability:.2f}."
        )

    for segment in segments:
        text = segment.text.strip()
        if not text:
            continue
        if segment.no_speech_prob > float(os.getenv("MAX_NO_SPEECH_PROB", "0.55")):
            continue
        if segment.avg_logprob < float(os.getenv("MIN_AVG_LOGPROB", "-1.0")):
            continue
        if _looks_repeated_noise(text):
            continue
        accepted_segments.append(text)

    transcript = " ".join(accepted_segments).strip()

    if not transcript:
        raise RuntimeError(
            f"No confident speech detected. language={info.language}, "
            f"language_probability={info.language_probability:.2f}"
        )

    return transcript


def _looks_repeated_noise(text: str) -> bool:
    cleaned = text.replace(",", " ").replace(".", " ").strip()
    words = [word for word in cleaned.split() if word]
    return len(words) >= 4 and len(set(words)) <= 2
