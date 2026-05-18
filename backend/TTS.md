# Backend TTS Engines

The backend `/speak` endpoint is controlled with `TTS_ENGINE`.

## Edge Neural TTS

Default:

```bash
TTS_ENGINE=edge
```

This uses `edge-tts` and supports Indian language male/female voices.

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
