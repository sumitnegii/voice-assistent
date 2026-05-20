import asyncio
import json
import subprocess
import sys
import urllib.error
import urllib.request
import uuid
import os
import shutil
from pathlib import Path
from functools import lru_cache


ENV_PATH = Path(__file__).parent / ".env"
AUDIO_DIR = Path(__file__).parent / "audio"
DEFAULT_XTTS_MODEL_NAME = "tts_models/multilingual/multi-dataset/xtts_v2"
DEFAULT_VOICE_SAMPLE = Path(__file__).parent / "voice_samples" / "speaker.wav"
DEFAULT_OPENVOICE_ROOT = Path(__file__).parents[1] / "OpenVoice"
DEFAULT_OPENVOICE_CONVERTER = DEFAULT_OPENVOICE_ROOT / "checkpoints_v2" / "converter"


def _load_env() -> None:
    if not ENV_PATH.exists():
        return

    for line in ENV_PATH.read_text().splitlines():
        cleaned = line.strip()
        if not cleaned or cleaned.startswith("#") or "=" not in cleaned:
            continue

        key, value = cleaned.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_load_env()

EDGE_VOICES = {
    "en": {"female": "en-IN-NeerjaNeural", "male": "en-IN-PrabhatNeural"},
    "hi": {"female": "hi-IN-SwaraNeural", "male": "hi-IN-MadhurNeural"},
    "bn": {"female": "bn-IN-TanishaaNeural", "male": "bn-IN-BashkarNeural"},
    "ta": {"female": "ta-IN-PallaviNeural", "male": "ta-IN-ValluvarNeural"},
    "te": {"female": "te-IN-ShrutiNeural", "male": "te-IN-MohanNeural"},
    "mr": {"female": "mr-IN-AarohiNeural", "male": "mr-IN-ManoharNeural"},
    "gu": {"female": "gu-IN-DhwaniNeural", "male": "gu-IN-NiranjanNeural"},
    "kn": {"female": "kn-IN-SapnaNeural", "male": "kn-IN-GaganNeural"},
    "ml": {"female": "ml-IN-SobhanaNeural", "male": "ml-IN-MidhunNeural"},
    "pa": {"female": "pa-IN-OjasNeural", "male": "pa-IN-OjasNeural"},
    "ur": {"female": "ur-IN-GulNeural", "male": "ur-IN-SalmanNeural"},
}
SVARA_VOICES = {
    "en": {"female": "en_female", "male": "en_male"},
    "hi": {"female": "hi_female", "male": "hi_male"},
    "bn": {"female": "bn_female", "male": "bn_male"},
    "ta": {"female": "ta_female", "male": "ta_male"},
    "te": {"female": "te_female", "male": "te_male"},
    "mr": {"female": "mr_female", "male": "mr_male"},
    "gu": {"female": "gu_female", "male": "gu_male"},
    "kn": {"female": "kn_female", "male": "kn_male"},
    "ml": {"female": "ml_female", "male": "ml_male"},
    "pa": {"female": "pa_female", "male": "pa_male"},
    "ne": {"female": "ne_female", "male": "ne_male"},
    "sa": {"female": "sa_female", "male": "sa_male"},
}


def synthesize_speech(
    text: str,
    language: str | None = None,
    voice_style: str | None = None,
) -> Path:
    """Create a local audio file using local/open TTS first when configured."""
    cleaned = text.strip()
    if not cleaned:
        raise ValueError("Text is required for TTS.")

    engine = os.getenv("TTS_ENGINE", "edge").lower()
    if engine in {"auto", "local"}:
        return _synthesize_with_fallback("XTTS", _synthesize_with_xtts, cleaned, language, voice_style)
    if engine in {"openvoice", "open_voice"}:
        if _fallback_enabled():
            return _synthesize_with_fallback("OpenVoice", _synthesize_with_openvoice, cleaned, language, voice_style)
        return _synthesize_with_openvoice(cleaned, language, voice_style)
    if engine == "xtts":
        if _fallback_enabled():
            return _synthesize_with_fallback("XTTS", _synthesize_with_xtts, cleaned, language, voice_style)
        return _synthesize_with_xtts(cleaned, language)
    if engine == "svara":
        if _fallback_enabled():
            return _synthesize_with_fallback("Svara", _synthesize_with_svara, cleaned, language, voice_style)
        return _synthesize_with_svara(cleaned, language, voice_style)
    if engine == "say":
        if os.getenv("TTS_ALLOW_MACOS_SAY", "").lower() in {"1", "true", "yes"}:
            if not _macos_say_available():
                return _synthesize_with_edge(cleaned, language, voice_style)
            return _synthesize_with_macos_say(cleaned)
        return _synthesize_with_edge(cleaned, language, voice_style)
    if engine == "edge":
        return _synthesize_with_edge(cleaned, language, voice_style)

    raise ValueError(f"Unsupported TTS_ENGINE={engine}. Use auto, edge, svara, xtts, openvoice, local, or say.")



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


def _macos_say_available() -> bool:
    return shutil.which("say") is not None and shutil.which("afconvert") is not None


def _synthesize_with_xtts(
    text: str,
    language: str | None = None,
    voice_style: str | None = None,
) -> Path:
    voice_sample = _voice_sample_path()
    if not voice_sample.exists():
        raise FileNotFoundError(
            f"XTTS speaker sample not found: {voice_sample}. "
            "Create backend/voice_samples/speaker.wav or set XTTS_SPEAKER_WAV."
        )

    AUDIO_DIR.mkdir(exist_ok=True)
    output_path = AUDIO_DIR / f"reply-{uuid.uuid4().hex}.wav"
    xtts_language = _speech_language(text, language, os.getenv("XTTS_LANGUAGE", "hi"))

    _get_xtts_model().tts_to_file(
        text=text[:800],
        speaker_wav=str(voice_sample),
        language=xtts_language,
        file_path=str(output_path),
    )

    return output_path


def _synthesize_with_edge(
    text: str,
    language: str | None = None,
    voice_style: str | None = None,
) -> Path:
    AUDIO_DIR.mkdir(exist_ok=True)
    output_path = AUDIO_DIR / f"reply-{uuid.uuid4().hex}.mp3"
    voice = _edge_voice(text, language, voice_style)
    timeout = float(os.getenv("EDGE_TTS_TIMEOUT", "25"))
    try:
        asyncio.run(asyncio.wait_for(_edge_save(text[:1800], voice, output_path), timeout=timeout))
    except TimeoutError as exc:
        output_path.unlink(missing_ok=True)
        raise RuntimeError(f"Edge TTS timed out after {timeout:.0f}s.") from exc

    if not output_path.exists() or output_path.stat().st_size == 0:
        output_path.unlink(missing_ok=True)
        raise RuntimeError("Edge TTS returned an empty audio file.")

    return output_path


def _synthesize_with_openvoice(
    text: str,
    language: str | None = None,
    voice_style: str | None = None,
) -> Path:
    """Use OpenVoice tone-color conversion over the existing Edge base TTS."""
    voice_sample = _openvoice_reference_path()
    if not voice_sample.exists():
        raise FileNotFoundError(
            f"OpenVoice reference audio not found: {voice_sample}. "
            "Create backend/voice_samples/speaker.wav or set OPENVOICE_REFERENCE_WAV."
        )

    converter_dir = _openvoice_converter_dir()
    config_path = converter_dir / "config.json"
    checkpoint_path = converter_dir / "checkpoint.pth"
    if not config_path.exists() or not checkpoint_path.exists():
        raise FileNotFoundError(
            f"OpenVoice converter checkpoint not found in {converter_dir}. "
            "Download checkpoints_v2_0417.zip and extract it into OpenVoice/checkpoints_v2."
        )

    AUDIO_DIR.mkdir(exist_ok=True)
    source_path = _synthesize_with_edge(text, language, voice_style)
    output_path = AUDIO_DIR / f"reply-{uuid.uuid4().hex}.wav"

    converter = _get_openvoice_converter(str(config_path), str(checkpoint_path))
    source_se = converter.extract_se([str(source_path)])
    target_se = converter.extract_se([str(voice_sample)])

    converter.convert(
        audio_src_path=str(source_path),
        src_se=source_se.to(converter.device),
        tgt_se=target_se.to(converter.device),
        output_path=str(output_path),
        message=os.getenv("OPENVOICE_WATERMARK", "@voice-assistent"),
    )

    if not output_path.exists() or output_path.stat().st_size == 0:
        output_path.unlink(missing_ok=True)
        raise RuntimeError("OpenVoice returned an empty audio file.")

    return output_path


def _synthesize_with_svara(
    text: str,
    language: str | None = None,
    voice_style: str | None = None,
) -> Path:
    base_url = os.getenv("SVARA_TTS_BASE_URL", "").rstrip("/")
    if not base_url:
        raise RuntimeError(
            "SVARA_TTS_BASE_URL is not set. Run the Kenpath Svara TTS API separately "
            "and set TTS_ENGINE=svara plus SVARA_TTS_BASE_URL, for example http://localhost:8080."
        )

    AUDIO_DIR.mkdir(exist_ok=True)
    output_path = AUDIO_DIR / f"reply-{uuid.uuid4().hex}.mp3"
    payload = {
        "model": os.getenv("SVARA_TTS_MODEL", "svara-tts-v1"),
        "voice": _svara_voice(language, voice_style),
        "input": _with_svara_style(text[:1800]),
        "response_format": "mp3",
    }

    request = urllib.request.Request(
        f"{base_url}/v1/audio/speech",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {os.getenv('SVARA_TTS_API_KEY', 'unused')}",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=int(os.getenv("SVARA_TTS_TIMEOUT", "120"))) as response:
            audio = response.read()
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Svara TTS request failed with {exc.code}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Svara TTS is not reachable at {base_url}: {exc}") from exc

    if not audio:
        raise RuntimeError("Svara TTS returned empty audio.")

    output_path.write_bytes(audio)
    return output_path


async def _edge_save(text: str, voice: str, output_path: Path) -> None:
    try:
        import edge_tts
    except ImportError as exc:
        raise RuntimeError(
            "Edge TTS is not installed. Run: pip install -r backend/requirements.txt"
        ) from exc

    communicate = edge_tts.Communicate(text, voice)
    await communicate.save(str(output_path))


def _edge_voice(text: str, language: str | None, voice_style: str | None) -> str:
    configured_voice = os.getenv("EDGE_TTS_VOICE")
    if configured_voice:
        return configured_voice
    if voice_style and voice_style.endswith("Neural"):
        return voice_style

    language_prefix = _speech_language(text, language, os.getenv("TTS_LANGUAGE", "hi-IN"))
    style = (voice_style or os.getenv("TTS_VOICE_STYLE", "female")).lower()
    if style not in {"male", "female"}:
        style = "female"

    voices = EDGE_VOICES.get(language_prefix) or EDGE_VOICES["en"]
    return voices.get(style) or voices["female"]


def _svara_voice(language: str | None, voice_style: str | None) -> str:
    configured_voice = os.getenv("SVARA_TTS_VOICE")
    if configured_voice:
        return configured_voice

    language_prefix = _language_prefix(language or os.getenv("TTS_LANGUAGE", "en-IN"))
    style = (voice_style or os.getenv("TTS_VOICE_STYLE", "female")).lower()
    if style not in {"male", "female"}:
        style = "female"

    voices = SVARA_VOICES.get(language_prefix) or SVARA_VOICES["en"]
    return voices.get(style) or voices["female"]


def _with_svara_style(text: str) -> str:
    style = os.getenv("SVARA_TTS_STYLE", "").strip()
    if not style:
        return text
    if not style.startswith("<"):
        style = f"<{style}>"
    return f"{text.rstrip()} {style}"


def _language_prefix(language: str) -> str:
    return language.split("-", 1)[0].lower()


def _synthesize_with_fallback(
    engine_name: str,
    synthesizer,
    text: str,
    language: str | None,
    voice_style: str | None,
) -> Path:
    try:
        if voice_style is None:
            return synthesizer(text, language)
        return synthesizer(text, language, voice_style)
    except Exception as exc:
        print(f"{engine_name} TTS failed, falling back to Edge:", _format_tts_error(exc))
        return _synthesize_with_edge(text, language, voice_style)


def _fallback_enabled() -> bool:
    return os.getenv("TTS_FALLBACK_TO_EDGE", "1").lower() not in {"0", "false", "no"}


def _voice_sample_path() -> Path:
    configured = os.getenv("XTTS_SPEAKER_WAV")
    if not configured:
        return DEFAULT_VOICE_SAMPLE

    path = Path(configured).expanduser()
    if path.is_absolute():
        return path
    return Path(__file__).parent / path


def _openvoice_reference_path() -> Path:
    configured = os.getenv("OPENVOICE_REFERENCE_WAV") or os.getenv("XTTS_SPEAKER_WAV")
    if not configured:
        return DEFAULT_VOICE_SAMPLE

    path = Path(configured).expanduser()
    if path.is_absolute():
        return path
    return Path(__file__).parent / path


def _openvoice_converter_dir() -> Path:
    configured = os.getenv("OPENVOICE_CONVERTER_DIR")
    if not configured:
        return DEFAULT_OPENVOICE_CONVERTER

    path = Path(configured).expanduser()
    if path.is_absolute():
        return path
    return Path(__file__).parents[1] / path


def _speech_language(text: str, language: str | None, fallback: str) -> str:
    if _contains_devanagari(text):
        return "hi"
    return _language_prefix(language or fallback)


def _contains_devanagari(text: str) -> bool:
    return any("\u0900" <= char <= "\u097f" for char in text)


def _format_tts_error(exc: Exception) -> str:
    return f"{type(exc).__name__}: {exc}"


@lru_cache(maxsize=1)
def _get_openvoice_converter(config_path: str, checkpoint_path: str):
    openvoice_root = Path(os.getenv("OPENVOICE_ROOT", str(DEFAULT_OPENVOICE_ROOT))).expanduser()
    if not openvoice_root.exists():
        raise RuntimeError(f"OpenVoice repo not found at {openvoice_root}.")

    root_string = str(openvoice_root)
    if root_string not in sys.path:
        sys.path.insert(0, root_string)

    try:
        import torch
        from openvoice.api import ToneColorConverter
    except ImportError as exc:
        raise RuntimeError(
            "OpenVoice dependencies are not installed. Use a Python 3.9 environment, "
            "then run: pip install -e OpenVoice"
        ) from exc

    configured_device = os.getenv("OPENVOICE_DEVICE")
    if configured_device:
        device = configured_device
    else:
        device = "cuda:0" if torch.cuda.is_available() else "cpu"

    converter = ToneColorConverter(
        config_path,
        device=device,
        enable_watermark=os.getenv("OPENVOICE_ENABLE_WATERMARK", "0").lower() in {"1", "true", "yes"},
    )
    converter.load_ckpt(checkpoint_path)
    return converter


@lru_cache(maxsize=1)
def _get_xtts_model():
    try:
        from TTS.api import TTS
    except ImportError as exc:
        raise RuntimeError(
            "XTTS is not installed. Install Coqui TTS in a compatible Python environment, "
            "then run with TTS_ENGINE=xtts."
        ) from exc

    return TTS(os.getenv("XTTS_MODEL_NAME", DEFAULT_XTTS_MODEL_NAME))
