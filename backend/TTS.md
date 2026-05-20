# Backend TTS Engines

The backend `/speak` endpoint is controlled with `TTS_ENGINE`.

## Recommended Hindi Setup

Use auto mode for the app:

```bash
TTS_ENGINE=auto
TTS_LANGUAGE=hi-IN
XTTS_LANGUAGE=hi
TTS_FALLBACK_TO_EDGE=1
```

This tries local XTTS-v2 first. If XTTS is not installed, Python is incompatible, or
`backend/voice_samples/speaker.wav` is missing, it falls back to Edge Hindi voice so
the assistant keeps working.

For a strict fully-local setup:

```bash
TTS_ENGINE=xtts
TTS_FALLBACK_TO_EDGE=0
XTTS_LANGUAGE=hi
XTTS_SPEAKER_WAV=voice_samples/speaker.wav
```

XTTS-v2 works best with Python 3.10 or 3.11. Python 3.13 is not recommended for
Coqui TTS.

Create this file for voice cloning:

```text
backend/voice_samples/speaker.wav
```

## Edge Neural TTS

Default:

```bash
TTS_ENGINE=edge
```

This uses `edge-tts` and supports Indian language male/female voices.

## OpenVoice Voice Cloning

The OpenVoice repo is cloned at:

```text
OpenVoice/
```

Use it from the backend with:

```bash
TTS_ENGINE=openvoice
OPENVOICE_REFERENCE_WAV=voice_samples/speaker.wav
TTS_FALLBACK_TO_EDGE=1
```

This backend integration uses Edge TTS to generate the base speech, then applies
OpenVoice tone-color conversion using your reference voice sample. That keeps
Hindi and Indian language output working through Edge while OpenVoice handles
the voice cloning step.

OpenVoice still needs its own dependencies and checkpoints. The upstream project
recommends Python 3.9:

```bash
python3.9 -m venv .venv-openvoice
source .venv-openvoice/bin/activate
pip install -r backend/requirements.txt
pip install -e OpenVoice
```

Then download OpenVoice V2 checkpoints from:

```text
https://myshell-public-repo-host.s3.amazonaws.com/openvoice/checkpoints_v2_0417.zip
```

Extract the zip so this folder exists:

```text
OpenVoice/checkpoints_v2/converter/
```

Required files:

```text
OpenVoice/checkpoints_v2/converter/config.json
OpenVoice/checkpoints_v2/converter/checkpoint.pth
```

Finally, add a reference voice recording:

```text
backend/voice_samples/speaker.wav
```

If OpenVoice fails or is not installed, `TTS_FALLBACK_TO_EDGE=1` makes the
assistant continue speaking with Edge TTS.

## Svara TTS

Svara requires a separate Kenpath Svara TTS API service. The model is too large to load inside this small FastAPI backend on typical free/low-memory hosts.

Run the official Svara inference server, then set:

```bash
TTS_ENGINE=svara
SVARA_TTS_BASE_URL=http://localhost:8080
```

Optional:

```bash
SVARA_TTS_MODEL=svara-tts-v1
SVARA_TTS_API_KEY=unused
SVARA_TTS_STYLE=clear
SVARA_TTS_TIMEOUT=120
```

The app maps the selected frontend language and voice model to Svara voice IDs like `te_female`, `te_male`, `hi_female`, and `hi_male`.

Official Svara API docs: https://github.com/Kenpath/svara-tts-inference
