from datetime import datetime


def run_tools(user_text: str) -> str:
    """Small tools stage for the pipeline.

    This is intentionally tiny for now. Later this function becomes your tool
    router: database lookups, search, calendar, emergency APIs, RAG, etc.
    """
    lowered = user_text.lower()

    if "time" in lowered:
        return f"Local server time: {datetime.now().strftime('%I:%M %p')}"

    if "date" in lowered or "today" in lowered:
        return f"Local server date: {datetime.now().strftime('%B %d, %Y')}"

    return ""
