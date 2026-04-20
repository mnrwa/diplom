"""
Lightweight news digest endpoint.
Extracts the most informative sentence from raw news text using
TF-IDF scoring weighted by road/logistics keywords.
No external LLM needed — runs entirely offline.
"""
import re
from typing import List
from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter(tags=["digest"])

# Keywords that indicate high-value road information
ROAD_KEYWORDS = {
    "авария": 3.0, "дтп": 3.0, "перекрытие": 2.8, "закрыт": 2.5,
    "пробка": 2.5, "затор": 2.5, "ремонт": 2.0, "ограничение": 2.0,
    "скорость": 1.8, "полоса": 2.0, "объезд": 2.5, "маршрут": 1.5,
    "км": 1.5, "трасса": 2.0, "дорог": 1.8, "мкад": 2.2, "съезд": 2.0,
    "вылет": 1.5, "погиб": 2.5, "пострадал": 2.2, "грузовик": 2.0,
    "фура": 2.0, "автобус": 1.8, "туман": 2.0, "снег": 2.0, "гололёд": 2.5,
    "лёд": 2.2, "дождь": 1.5, "видимост": 2.0, "опасн": 2.0,
}


def _clean_text(text: str) -> str:
    """Remove URLs, Telegram entities, extra whitespace."""
    text = re.sub(r"https?://\S+", "", text)
    text = re.sub(r"@\w+", "", text)
    text = re.sub(r"#\w+", "", text)
    text = re.sub(r"\s{2,}", " ", text)
    return text.strip()


def _split_sentences(text: str) -> List[str]:
    """Split Russian text into sentences."""
    parts = re.split(r"(?<=[.!?])\s+(?=[А-ЯA-Z])", text)
    result = []
    for p in parts:
        p = p.strip()
        if len(p) > 15:
            result.append(p)
    return result


def _score_sentence(sent: str) -> float:
    lower = sent.lower()
    score = 0.0
    for kw, weight in ROAD_KEYWORDS.items():
        if kw in lower:
            score += weight
    # Bonus for having numbers (km, time)
    score += len(re.findall(r"\d+", sent)) * 0.3
    # Penalty for being too short or too long
    words = len(sent.split())
    if words < 5:
        score *= 0.3
    elif words > 40:
        score *= 0.7
    return score


def _is_duplicate(a: str, b: str, threshold: float = 0.7) -> bool:
    """Check if sentence a is mostly contained in sentence b."""
    a_words = set(a.lower().split())
    b_words = set(b.lower().split())
    if not a_words:
        return False
    overlap = len(a_words & b_words) / len(a_words)
    return overlap >= threshold


def digest_news(title: str, summary: str) -> str:
    """
    Extract the most informative 1-2 sentences from title + summary.
    Returns a concise digest string.
    """
    title = _clean_text(title or "")
    summary = _clean_text(summary or "")

    # If summary is basically the title, just clean the title
    if not summary or _is_duplicate(summary, title, threshold=0.8):
        return _trim_to_sentence(title, max_words=25)

    # Combine and split into sentences
    full_text = summary if summary.startswith(title[:20]) else f"{title}. {summary}"
    sentences = _split_sentences(full_text)

    if not sentences:
        return _trim_to_sentence(title, max_words=25)

    # Score and pick best
    scored = [(s, _score_sentence(s)) for s in sentences]
    scored.sort(key=lambda x: -x[1])

    best = scored[0][0]

    # If the best sentence is too short, try combining top-2
    if len(best.split()) < 8 and len(scored) > 1:
        second = scored[1][0]
        if not _is_duplicate(best, second):
            combined = f"{best} {second}"
            if len(combined.split()) <= 45:
                best = combined

    return _trim_to_sentence(best, max_words=40)


def _trim_to_sentence(text: str, max_words: int = 30) -> str:
    words = text.split()
    if len(words) <= max_words:
        return text
    truncated = " ".join(words[:max_words])
    # Try to end at a natural boundary
    for punct in [".", ",", ";", "—"]:
        idx = truncated.rfind(punct)
        if idx > len(truncated) // 2:
            return truncated[: idx + 1]
    return truncated + "..."


# ── API ────────────────────────────────────────────────────────────────────────

class NewsItem(BaseModel):
    id: str
    title: str
    summary: str = ""


class DigestResult(BaseModel):
    id: str
    digest: str


@router.post("/ai/news-digest", response_model=List[DigestResult])
def news_digest(items: List[NewsItem]):
    """
    Process a list of news items and return a concise digest for each.
    Uses keyword-weighted TF-IDF sentence extraction.
    """
    return [
        DigestResult(id=item.id, digest=digest_news(item.title, item.summary))
        for item in items
    ]
