import os
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime
from zoneinfo import ZoneInfo


TIME_KEYWORDS = {
    "time",
    "clock",
    "समय",
    "वक्त",
    "समय क्या",
    "సమయం",
    "ఎంత",
    "நேரம்",
    "সময়",
    "সময় কত",
    "સમય",
    "ಸಮಯ",
    "സമയം",
    "ਵੇਲਾ",
    "وقت",
}

DATE_KEYWORDS = {
    "date",
    "today",
    "आज",
    "तारीख",
    "ఈరోజు",
    "తేదీ",
    "இன்று",
    "தேதி",
    "আজ",
    "তারিখ",
    "આજે",
    "તારીખ",
    "ಇಂದು",
    "ದಿನಾಂಕ",
    "ഇന്ന്",
    "തീയതി",
    "ਅੱਜ",
    "تاریخ",
}

NEWS_KEYWORDS = {
    "news",
    "headlines",
    "latest",
    "breaking",
    "వార్త",
    "వార్తలు",
    "కొత్త వార్తలు",
    "తాజా",
    "समाचार",
    "खबर",
    "ख़बर",
    "ताजा",
    "செய்தி",
    "செய்திகள்",
    "খবর",
    "সংবাদ",
    "સમાચાર",
    "ಸುದ್ದಿ",
    "വാർത്ത",
    "ਖ਼ਬਰ",
    "خبر",
}

NEWS_FEEDS = {
    "en": "https://news.google.com/rss?hl=en-IN&gl=IN&ceid=IN:en",
    "hi": "https://news.google.com/rss?hl=hi-IN&gl=IN&ceid=IN:hi",
    "te": "https://news.google.com/rss?hl=te&gl=IN&ceid=IN:te",
    "ta": "https://news.google.com/rss?hl=ta&gl=IN&ceid=IN:ta",
    "bn": "https://news.google.com/rss?hl=bn&gl=IN&ceid=IN:bn",
    "mr": "https://news.google.com/rss?hl=mr&gl=IN&ceid=IN:mr",
    "gu": "https://news.google.com/rss?hl=gu&gl=IN&ceid=IN:gu",
    "kn": "https://news.google.com/rss?hl=kn&gl=IN&ceid=IN:kn",
    "ml": "https://news.google.com/rss?hl=ml&gl=IN&ceid=IN:ml",
    "pa": "https://news.google.com/rss?hl=pa&gl=IN&ceid=IN:pa",
    "ur": "https://news.google.com/rss?hl=ur&gl=IN&ceid=IN:ur",
}


def run_tools(user_text: str) -> str:
    """Small tools stage for the pipeline.

    This is intentionally tiny for now. Later this function becomes your tool
    router: database lookups, search, calendar, emergency APIs, RAG, etc.
    """
    lowered = user_text.lower()
    now = _local_now()

    if _contains_keyword(lowered, TIME_KEYWORDS):
        return f"Current local time in {_timezone_name()}: {now.strftime('%I:%M %p')}"

    if _contains_keyword(lowered, NEWS_KEYWORDS):
        return _latest_news(user_text)

    if _contains_keyword(lowered, DATE_KEYWORDS):
        return f"Current local date in {_timezone_name()}: {now.strftime('%B %d, %Y')}"

    return ""


def _local_now() -> datetime:
    return datetime.now(ZoneInfo(_timezone_name()))


def _timezone_name() -> str:
    return os.getenv("LOCAL_TIMEZONE", "Asia/Kolkata")


def _contains_keyword(text: str, keywords: set[str]) -> bool:
    return any(keyword in text for keyword in keywords)


def _latest_news(user_text: str) -> str:
    language = _detect_language(user_text)
    feed_url = os.getenv("NEWS_RSS_URL") or NEWS_FEEDS.get(language) or NEWS_FEEDS["en"]
    try:
        request = urllib.request.Request(
            feed_url,
            headers={"User-Agent": "voice-assistant/1.0"},
        )
        with urllib.request.urlopen(request, timeout=8) as response:
            xml_text = response.read()

        root = ET.fromstring(xml_text)
        items = root.findall("./channel/item")[:5]
        headlines = []
        for item in items:
            title = (item.findtext("title") or "").strip()
            source = item.findtext("source") or ""
            if title:
                source_text = f" ({source.strip()})" if source.strip() else ""
                headlines.append(f"- {title}{source_text}")

        if not headlines:
            return "News lookup result: no current headlines were found."

        return "Latest India news headlines from Google News RSS:\n" + "\n".join(headlines)
    except Exception as exc:
        return f"News lookup failed: {exc}"


def _detect_language(text: str) -> str:
    lowered = text.lower()
    language_markers = {
        "te": ("వార్త", "వార్తలు", "ఈరోజు", "సమయం"),
        "hi": ("समाचार", "खबर", "आज", "समय"),
        "ta": ("செய்தி", "இன்று", "நேரம்"),
        "bn": ("খবর", "সংবাদ", "আজ"),
        "mr": ("बातम्या", "आज"),
        "gu": ("સમાચાર", "આજે"),
        "kn": ("ಸುದ್ದಿ", "ಇಂದು"),
        "ml": ("വാർത്ത", "ഇന്ന്"),
        "pa": ("ਖ਼ਬਰ", "ਅੱਜ"),
        "ur": ("خبر", "آج"),
    }
    for language, markers in language_markers.items():
        if any(marker in lowered for marker in markers):
            return language
    return "en"
