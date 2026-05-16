import json
import os
import urllib.error
import urllib.request
from pathlib import Path


SYSTEM_PROMPT = (
    "You are a concise, helpful voice assistant. "
    "Reply in one or two short spoken sentences because your answer will be converted to speech."
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


def generate_reply(message: str) -> str:
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
            return _claude_reply(cleaned)
        except Exception:
            return f"I could not reach Claude right now. Local fallback says: you said {cleaned}."

    if os.getenv("OPENAI_API_KEY"):
        try:
            return _openai_reply(cleaned)
        except Exception:
            return f"I could not reach OpenAI right now. Local fallback says: you said {cleaned}."

    try:
        return _ollama_reply(cleaned)
    except Exception:
        return f"Prototype reply: I heard you say, {cleaned}"


def _claude_reply(message: str) -> str:
    api_key = os.environ["CLAUDE_API_KEY"]
    model = os.getenv("CLAUDE_MODEL", "claude-haiku-4-5-20251001")

    payload = {
        "model": model,
        "max_tokens": 120,
        "system": SYSTEM_PROMPT,
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


def _openai_reply(message: str) -> str:
    api_key = os.environ["OPENAI_API_KEY"]
    model = os.getenv("OPENAI_MODEL", "gpt-4o-mini")

    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
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


def _ollama_reply(message: str) -> str:
    base_url = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434").rstrip("/")
    model = os.getenv("OLLAMA_MODEL", "llama3.2")

    payload = {
        "model": model,
        "stream": False,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
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
