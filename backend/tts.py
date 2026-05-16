import subprocess
import uuid
import os
from pathlib import Path
from functools import lru_cache


AUDIO_DIR = Path(__file__).parent / "audio"
VOICE_SAMPLE = Path(os.getenv("XTTS_SPEAKER_WAV", Path(__file__).parent / "voice_samples" / "speaker.wav"))
XTTS_MODEL_NAME = os.getenv("XTTS_MODEL_NAME", "tts_models/multilingual/multi-dataset/xtts_v2")


def synthesize_speech(text: str) -> Path:
    """Create a local audio file using XTTS-v2 or macOS built-in TTS."""
    cleaned = text.strip()
    if not cleaned:
        raise ValueError("Text is required for TTS.")

    if os.getenv("TTS_ENGINE", "say").lower() == "xtts":
        return _synthesize_with_xtts(cleaned)

    return _synthesize_with_macos_say(cleaned)


def _synthesize_with_macos_say(text: str) -> Path:
    AUDIO_DIR.mkdir(exist_ok=True)
    audio_id = uuid.uuid4().hex
    raw_path = AUDIO_DIR / f"reply-{audio_id}.aiff"
    output_path = AUDIO_DIR / f"reply-{audio_id}.wav"

    subprocess.run(
        ["say", "-r", os.getenv("SAY_RATE", "235"), "-o", str(raw_path), text[:1200]],
        check=True,
        timeout=90,
    )
    subprocess.run(
        ["afconvert", "-f", "WAVE", "-d", "LEI16", str(raw_path), str(output_path)],
        check=True,
        timeout=90,
    )
    raw_path.unlink(missing_ok=True)

    return output_path


def _synthesize_with_xtts(text: str) -> Path:
    if not VOICE_SAMPLE.exists():
        raise FileNotFoundError(
            f"XTTS speaker sample not found: {VOICE_SAMPLE}. "
            "Create backend/voice_samples/speaker.wav or set XTTS_SPEAKER_WAV."
        )

    AUDIO_DIR.mkdir(exist_ok=True)
    output_path = AUDIO_DIR / f"reply-{uuid.uuid4().hex}.wav"
    language = os.getenv("XTTS_LANGUAGE", "en")

    _get_xtts_model().tts_to_file(
        text=text[:800],
        speaker_wav=str(VOICE_SAMPLE),
        language=language,
        file_path=str(output_path),
    )

    return output_path


@lru_cache(maxsize=1)
def _get_xtts_model():
    try:
        from TTS.api import TTS
    except ImportError as exc:
        raise RuntimeError(
            "XTTS is not installed. Install Coqui TTS in a compatible Python environment, "
            "then run with TTS_ENGINE=xtts."
        ) from exc

    return TTS(XTTS_MODEL_NAME)
