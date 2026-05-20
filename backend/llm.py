import json
import os
import urllib.error
import urllib.request
from pathlib import Path


BASE_SYSTEM_PROMPT = (
    "You are a concise, helpful voice assistant. "
    "Reply in one or two short spoken sentences because your answer will be converted to speech. "
    "If the user message includes a Tool result section, use that information directly and do not say you lack access."
)

ENV_PATH = Path(__file__).parent / ".env"


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


def generate_reply(
    message: str,
    language: str | None = None,
    voice_style: str | None = None,
) -> str:
    """Generate a short assistant reply.

    Priority:
    1. Claude, if CLAUDE_API_KEY is set in backend/.env.
    2. OpenAI, if OPENAI_API_KEY is set.
    3. Ollama, if it is running locally.
    4. A local fallback, so the prototype still works.
    """
    cleaned = message.strip()
    if not cleaned:
        return "Please say or type something first."

    if os.getenv("CLAUDE_API_KEY"):
        try:
            return _claude_reply(cleaned, language, voice_style)
        except Exception as exc:
            print("Claude request failed:", _format_request_error(exc))

    if os.getenv("OPENAI_API_KEY"):
        try:
            return _openai_reply(cleaned, language, voice_style)
        except Exception as exc:
            print("OpenAI request failed:", _format_request_error(exc))

    try:
        return _ollama_reply(cleaned, language, voice_style)
    except Exception as exc:
        print("Ollama request failed:", _format_request_error(exc))
        return _local_fallback_reply(cleaned, language, voice_style)


def _claude_reply(message: str, language: str | None, voice_style: str | None) -> str:
    api_key = os.environ["CLAUDE_API_KEY"]
    model = os.getenv("CLAUDE_MODEL", "claude-haiku-4-5-20251001")

    payload = {
        "model": model,
        "max_tokens": 120,
        "system": _system_prompt(language, voice_style),
        "messages": [
            {"role": "user", "content": message},
        ],
    }

    request = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    with urllib.request.urlopen(request, timeout=45) as response:
        data = json.loads(response.read().decode("utf-8"))

    text_blocks = [
        block["text"]
        for block in data.get("content", [])
        if block.get("type") == "text" and block.get("text")
    ]
    return " ".join(text_blocks).strip()


def _openai_reply(message: str, language: str | None, voice_style: str | None) -> str:  # if claude is unable use this
    api_key = os.environ["OPENAI_API_KEY"]
    model = os.getenv("OPENAI_MODEL", "gpt-4o-mini")

    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": _system_prompt(language, voice_style)},
            {"role": "user", "content": message},
        ],
        "temperature": 0.7,
    }

    request = urllib.request.Request(
        "https://api.openai.com/v1/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    with urllib.request.urlopen(request, timeout=45) as response:
        data = json.loads(response.read().decode("utf-8"))

    return data["choices"][0]["message"]["content"].strip()


def _ollama_reply(message: str, language: str | None, voice_style: str | None) -> str:  # if claude and openAi is unable this
    base_url = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434").rstrip("/")
    model = os.getenv("OLLAMA_MODEL", "llama3.2")

    payload = {
        "model": model,
        "stream": False,
        "messages": [
            {"role": "system", "content": _system_prompt(language, voice_style)},
            {"role": "user", "content": message},
        ],
    }

    request = urllib.request.Request(
        f"{base_url}/api/chat",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            data = json.loads(response.read().decode("utf-8"))
    except urllib.error.URLError as exc:
        raise RuntimeError("Ollama is not reachable") from exc

    return data["message"]["content"].strip()


def _format_request_error(exc: Exception) -> str:
    if isinstance(exc, urllib.error.HTTPError):
        try:
            detail = exc.read().decode("utf-8", errors="replace")
        except Exception:
            detail = ""
        return f"HTTP {exc.code} {exc.reason}: {detail}"

    if isinstance(exc, urllib.error.URLError):
        return f"{type(exc).__name__}: {exc.reason}"

    return f"{type(exc).__name__}: {exc}"


def _system_prompt(language: str | None, voice_style: str | None = None) -> str:
    language_prefix = _language_prefix(language)
    voice_prompt = _voice_persona_prompt(voice_style)
    if language_prefix == "en":
        return f"{BASE_SYSTEM_PROMPT} {voice_prompt} Reply in English."
    if language_prefix == "hi":
        return f"{BASE_SYSTEM_PROMPT} {voice_prompt} Reply naturally in Hindi or Hinglish."
    if language_prefix:
        return f"{BASE_SYSTEM_PROMPT} {voice_prompt} Reply in the user's selected language: {language}."
    return f"{BASE_SYSTEM_PROMPT} {voice_prompt} Reply in the same language as the user."


def _local_fallback_reply(
    message: str,
    language: str | None = None,
    voice_style: str | None = None,
) -> str:
    language_prefix = _language_prefix(language)
    prefix = _local_voice_prefix(voice_style)
    if language_prefix == "en":
        return f"{prefix}I heard you say: {message}. The AI model is unavailable right now, but the voice system is working."
    if language_prefix == "hi" or _looks_hindi_or_hinglish(message):
        return f"{prefix}Mainne suna: {message}. Abhi AI model available nahi hai, lekin voice system chal raha hai."
    return f"{prefix}I heard you say: {message}. The AI model is unavailable right now, but the voice system is working."


def _voice_persona_prompt(voice_style: str | None) -> str:
    voice = (voice_style or "").lower()
    if _is_male_voice(voice):
        return (
            "Use a warm, confident male assistant persona. "
            "Do not mention that you are male unless the user asks."
        )
    if _is_female_voice(voice):
        return (
            "Use a warm, friendly female assistant persona. "
            "Do not mention that you are female unless the user asks."
        )
    return "Use a neutral assistant persona."


def _local_voice_prefix(voice_style: str | None) -> str:
    voice = (voice_style or "").lower()
    if _is_male_voice(voice):
        return "Male assistant: "
    if _is_female_voice(voice):
        return "Female assistant: "
    return ""


def _is_male_voice(voice_style: str) -> bool:
    return voice_style == "male" or any(
        name in voice_style
        for name in {
            "madhur",
            "prabhat",
            "bashkar",
            "valluvar",
            "mohan",
            "manohar",
            "niranjan",
            "gagan",
            "midhun",
            "salman",
        }
    )


def _is_female_voice(voice_style: str) -> bool:
    return voice_style == "female" or any(
        name in voice_style
        for name in {
            "swara",
            "neerja",
            "tanishaa",
            "pallavi",
            "shruti",
            "aarohi",
            "dhwani",
            "sapna",
            "sobhana",
            "gul",
        }
    )


def _language_prefix(language: str | None) -> str:
    if not language or language == "auto":
        return ""
    return language.split("-", 1)[0].lower()


def _looks_hindi_or_hinglish(message: str) -> bool:
    lowered = message.lower()
    hindi_words = {
        "hai",
        "hain",
        "kya",
        "kaise",
        "mera",
        "mere",
        "mujhe",
        "namaste",
        "achha",
        "accha",
        "batao",
    }
    return any("\u0900" <= char <= "\u097f" for char in message) or any(
        word in lowered.split() for word in hindi_words
    )
